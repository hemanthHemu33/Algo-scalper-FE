import React from "react";
import { useSettings } from "./lib/settingsContext";
import {
  useAlertChannels,
  useAlertIncidents,
  useAuditLogs,
  useCostCalibration,
  useEquity,
  useExecutionQuality,
  useFnoUniverse,
  useMarketCalendar,
  useMarketHealth,
  useOptimizerSnapshot,
  useOrders,
  usePositions,
  useRejections,
  useRiskLimits,
  useStatus,
  useStrategyKpis,
  useSubscriptions,
  useTelemetrySnapshot,
  useTradeTelemetrySnapshot,
  useTradesRecent,
} from "./lib/hooks";
import { postJson } from "./lib/http";
import { buildKiteLoginUrl, parseKiteRedirect } from "./lib/kiteAuth";
import { ChartPanel, type ChartConfig, type FeedHealth } from "./components/ChartPanel";
import { TradeBlotter } from "./components/TradeBlotter";
import { useSocketBridge } from "./lib/socket";
import { formatPrettyInstrumentFromTrade, formatPrettyInstrumentFromTradingSymbol } from "./lib/instrumentFormat";
import type { TradeRow } from "./types/backend";

type ToastLevel = "good" | "warn" | "bad";
type Toast = { id: string; level: ToastLevel; message: string; createdAt: number };

const LAYOUT_KEY = "kite_scalper_dashboard_layout_v1";

type SavedLayout = {
  charts?: ChartConfig[];
  blotterLimit?: 20 | 50;
  blotterOpen?: boolean;
};

type DateRangeKey = "1D" | "7D" | "30D" | "90D" | "ALL";

const DATE_RANGE_OPTIONS: Array<{ key: DateRangeKey; label: string; days: number | null }> = [
  { key: "1D", label: "1D", days: 1 },
  { key: "7D", label: "7D", days: 7 },
  { key: "30D", label: "30D", days: 30 },
  { key: "90D", label: "90D", days: 90 },
  { key: "ALL", label: "All", days: null },
];

function loadLayout(): SavedLayout {
  try {
    const raw = localStorage.getItem(LAYOUT_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || !parsed) return {};
    return parsed as SavedLayout;
  } catch {
    return {};
  }
}

function saveLayout(next: SavedLayout) {
  try {
    localStorage.setItem(LAYOUT_KEY, JSON.stringify(next));
  } catch {
    // ignore
  }
}

function normalizeBaseUrl(u: string) {
  return u.trim().replace(/\/$/, "");
}

const KITE_SESSION_PATH =
  import.meta.env.VITE_KITE_SESSION_PATH || "/admin/kite/session";

function buildTokenLabelsFromTrades(trades: TradeRow[]) {
  const map: Record<number, string> = {};
  for (const t of trades || []) {
    const tok = Number(t.instrument_token);
    if (!Number.isFinite(tok) || map[tok]) continue;
    const pretty = formatPrettyInstrumentFromTrade(t);
    if (pretty && pretty !== "-") map[tok] = pretty;
  }
  return map;
}

function labelForToken(token: number, tokenLabels: Record<number, string>) {
  const pretty = tokenLabels?.[token];
  return pretty ? String(pretty) : String(token);
}

function fmtLag(sec: number | null) {
  if (sec === null || !Number.isFinite(sec) || sec < 0) return "-";
  if (sec < 60) return `${Math.round(sec)}s`;
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}m ${s}s`;
}

function genId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function fmtNumber(n: number | null | undefined, digits = 2) {
  if (!Number.isFinite(n as number)) return "-";
  return Number(n).toFixed(digits);
}

function fmtCompact(n: number | null | undefined) {
  if (!Number.isFinite(n as number)) return "-";
  return new Intl.NumberFormat("en-IN", {
    notation: "compact",
    maximumFractionDigits: 2,
  }).format(Number(n));
}

function fmtCurrency(n: number | null | undefined) {
  if (!Number.isFinite(n as number)) return "-";
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(Number(n));
}

function fmtPercent(n: number | null | undefined) {
  if (!Number.isFinite(n as number)) return "-";
  return `${Number(n).toFixed(1)}%`;
}

function formatSince(ts?: string | null) {
  if (!ts) return "-";
  const ms = new Date(ts).getTime();
  if (!Number.isFinite(ms)) return "-";
  const diff = Math.max(0, Date.now() - ms);
  const min = Math.floor(diff / 60000);
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${h}h ${m}m`;
}

function statusBucket(status?: string) {
  const s = (status || "").toUpperCase();
  if (s.includes("OPEN") || s.includes("ACTIVE")) return "open";
  if (s.includes("CLOSED") || s.includes("DONE") || s.includes("EXIT")) return "closed";
  if (s.includes("REJECT") || s.includes("CANCEL") || s.includes("FAIL")) return "rejected";
  return "other";
}

function calcTradeStats(rows: TradeRow[]) {
  const closed = rows.filter((t) => statusBucket(t.status) === "closed");
  const open = rows.filter((t) => statusBucket(t.status) === "open");
  const rejected = rows.filter((t) => statusBucket(t.status) === "rejected");

  let pnl = 0;
  let wins = 0;
  let losses = 0;
  let holdMs = 0;
  let holdCount = 0;
  let exposure = 0;

  for (const t of rows) {
    const qty = Number(t.qty);
    const entry = Number(t.entryPrice);
    if (Number.isFinite(qty) && Number.isFinite(entry)) {
      exposure += qty * entry;
    }
  }

  for (const t of closed) {
    const qty = Number(t.qty);
    const entry = Number(t.entryPrice);
    const exit = Number(t.exitPrice);
    const side = (t.side || "").toUpperCase();
    if (Number.isFinite(qty) && Number.isFinite(entry) && Number.isFinite(exit)) {
      const raw = side === "SELL" ? (entry - exit) * qty : (exit - entry) * qty;
      pnl += raw;
      if (raw >= 0) wins += 1;
      else losses += 1;
    }

    const start = t.createdAt ? new Date(t.createdAt).getTime() : NaN;
    const end = t.updatedAt ? new Date(t.updatedAt).getTime() : NaN;
    if (Number.isFinite(start) && Number.isFinite(end) && end >= start) {
      holdMs += end - start;
      holdCount += 1;
    }
  }

  const winRate = closed.length ? (wins / closed.length) * 100 : null;
  const avgHoldMin = holdCount ? holdMs / holdCount / 60000 : null;

  return {
    total: rows.length,
    closed: closed.length,
    open: open.length,
    rejected: rejected.length,
    wins,
    losses,
    pnl,
    winRate,
    avgHoldMin,
    exposure,
  };
}

export default function App() {
  const { settings, setSettings } = useSettings();
  const [draftBase, setDraftBase] = React.useState(settings.baseUrl);
  const [draftKey, setDraftKey] = React.useState(settings.apiKey);
  const [draftKiteApiKey, setDraftKiteApiKey] = React.useState(settings.kiteApiKey);

  const [toasts, setToasts] = React.useState<Toast[]>([]);

  const pushToast = React.useCallback((level: ToastLevel, message: string) => {
    const t: Toast = { id: genId(), level, message, createdAt: Date.now() };
    setToasts((prev) => [...prev, t].slice(-6));
    // auto-expire
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((x) => x.id !== t.id));
    }, 9000);
  }, []);

  const saved = React.useMemo(() => loadLayout(), []);

  const socketState = useSocketBridge();
  const statusQ = useStatus(2000);
  const subsQ = useSubscriptions(5000);
  // Keep a lightweight poll even when WS is connected: some backends may not emit trade events.
  // Fetch a bigger window so token→symbol learning covers more instruments.
  const tradesQ = useTradesRecent(200, socketState.connected ? 5000 : 2000);
  const equityQ = useEquity(6000);
  const positionsQ = usePositions(8000);
  const ordersQ = useOrders(8000);
  const riskQ = useRiskLimits(10000);
  const strategyQ = useStrategyKpis(12000);
  const executionQ = useExecutionQuality(12000);
  const marketHealthQ = useMarketHealth(8000);
  const auditQ = useAuditLogs(15000);
  const alertChannelsQ = useAlertChannels(20000);
  const alertIncidentsQ = useAlertIncidents(15000);
  const telemetryQ = useTelemetrySnapshot(20000);
  const tradeTelemetryQ = useTradeTelemetrySnapshot(20000);
  const optimizerQ = useOptimizerSnapshot(20000);
  const rejectionsQ = useRejections(20000);
  const costCalibQ = useCostCalibration(30000);
  const calendarQ = useMarketCalendar(30000);
  const fnoQ = useFnoUniverse(60000);

  const tokens: number[] = subsQ.data?.tokens || [];
  const trades = tradesQ.data?.rows || [];

  const tokenLabels = React.useMemo(() => {
    const map = buildTokenLabelsFromTrades(trades);

    // If backend includes activeTrade details, use it too (best-effort).
    const at: any = statusQ.data?.activeTrade;
    const tok = Number(at?.instrument_token);
    const sym = at?.instrument?.tradingsymbol;
    if (Number.isFinite(tok) && sym && !map[tok]) {
      map[tok] = formatPrettyInstrumentFromTradingSymbol(sym) || String(sym);
    }

    return map;
  }, [trades, statusQ.data?.activeTrade]);

  const serverNowMs = React.useMemo(() => {
    const nowIso = statusQ.data?.now;
    const ms = nowIso ? new Date(nowIso).getTime() : NaN;
    return Number.isFinite(ms) ? ms : Date.now();
  }, [statusQ.data?.now]);

  const [dateRange, setDateRange] = React.useState<DateRangeKey>("ALL");

  const rangeConfig = React.useMemo(
    () => DATE_RANGE_OPTIONS.find((opt) => opt.key === dateRange) || DATE_RANGE_OPTIONS[0],
    [dateRange],
  );

  const rangeStartMs = React.useMemo(() => {
    if (!rangeConfig.days) return null;
    return serverNowMs - rangeConfig.days * 24 * 60 * 60 * 1000;
  }, [rangeConfig.days, serverNowMs]);

  const filteredTrades = React.useMemo(() => {
    if (!rangeStartMs) return trades;
    return (trades || []).filter((t) => {
      const ts = new Date(t.updatedAt || t.createdAt || "").getTime();
      return Number.isFinite(ts) && ts >= rangeStartMs;
    });
  }, [rangeStartMs, trades]);

  const filteredTradeStats = React.useMemo(() => calcTradeStats(filteredTrades), [filteredTrades]);
  const allTradeStats = React.useMemo(() => calcTradeStats(trades), [trades]);

  const remainingTradeCount = Math.max(0, allTradeStats.total - filteredTradeStats.total);
  const remainingPnl = allTradeStats.pnl - filteredTradeStats.pnl;

  const strategyStats = React.useMemo(() => {
    const map = new Map<string, { id: string; count: number; wins: number; pnl: number }>();
    for (const t of filteredTrades || []) {
      const id = t.strategyId || "unassigned";
      if (!map.has(id)) map.set(id, { id, count: 0, wins: 0, pnl: 0 });
      const row = map.get(id)!;
      row.count += 1;
      const qty = Number(t.qty);
      const entry = Number(t.entryPrice);
      const exit = Number(t.exitPrice);
      const side = (t.side || "").toUpperCase();
      if (Number.isFinite(qty) && Number.isFinite(entry) && Number.isFinite(exit)) {
        const raw = side === "SELL" ? (entry - exit) * qty : (exit - entry) * qty;
        row.pnl += raw;
        if (raw >= 0) row.wins += 1;
      }
    }
    return Array.from(map.values())
      .map((row) => ({
        ...row,
        winRate: row.count ? (row.wins / row.count) * 100 : null,
      }))
      .sort((a, b) => b.pnl - a.pnl)
      .slice(0, 6);
  }, [filteredTrades]);

  const instrumentPulse = React.useMemo(() => {
    const map = new Map<number, { token: number; count: number; pnl: number }>();
    for (const t of filteredTrades || []) {
      const token = Number(t.instrument_token);
      if (!Number.isFinite(token)) continue;
      if (!map.has(token)) map.set(token, { token, count: 0, pnl: 0 });
      const row = map.get(token)!;
      row.count += 1;
      const qty = Number(t.qty);
      const entry = Number(t.entryPrice);
      const exit = Number(t.exitPrice);
      const side = (t.side || "").toUpperCase();
      if (Number.isFinite(qty) && Number.isFinite(entry) && Number.isFinite(exit)) {
        const raw = side === "SELL" ? (entry - exit) * qty : (exit - entry) * qty;
        row.pnl += raw;
      }
    }
    return Array.from(map.values())
      .sort((a, b) => b.pnl - a.pnl)
      .slice(0, 5);
  }, [filteredTrades]);

  const recentActivity = React.useMemo(() => {
    return (filteredTrades || [])
      .slice(0, 6)
      .map((t) => ({
        id: t.tradeId,
        token: Number(t.instrument_token),
        side: t.side,
        status: t.status,
        updatedAt: t.updatedAt || t.createdAt,
        pnl: (() => {
          const qty = Number(t.qty);
          const entry = Number(t.entryPrice);
          const exit = Number(t.exitPrice);
          const side = (t.side || "").toUpperCase();
          if (Number.isFinite(qty) && Number.isFinite(entry) && Number.isFinite(exit)) {
            return side === "SELL" ? (entry - exit) * qty : (exit - entry) * qty;
          }
          return null;
        })(),
      }));
  }, [filteredTrades]);

  const defaultCharts: ChartConfig[] = React.useMemo(
    () => [
      { token: null, intervalMin: 1 },
      { token: null, intervalMin: 1 },
      { token: null, intervalMin: 3 },
      { token: null, intervalMin: 3 },
    ],
    []
  );

  const [charts, setCharts] = React.useState<ChartConfig[]>(() => {
    const c = saved.charts;
    if (Array.isArray(c) && c.length === 4) {
      return c.map((x) => ({ token: x?.token ?? null, intervalMin: Number(x?.intervalMin || 1) })) as any;
    }
    return defaultCharts;
  });

  const [blotterLimit, setBlotterLimit] = React.useState<20 | 50>(() => (saved.blotterLimit === 50 ? 50 : 20));
  const [blotterOpen, setBlotterOpen] = React.useState(() => (saved.blotterOpen === false ? false : true));

  // Persist layout so refresh doesn't wipe your charts.
  React.useEffect(() => {
    const t = window.setTimeout(() => {
      saveLayout({ charts, blotterLimit, blotterOpen });
    }, 250);
    return () => window.clearTimeout(t);
  }, [charts, blotterLimit, blotterOpen]);

  const resetLayout = React.useCallback(() => {
    setCharts(defaultCharts);
    setBlotterLimit(20);
    setBlotterOpen(true);
    pushToast("warn", "Layout reset to default");
  }, [defaultCharts, pushToast]);

  const [selectedToken, setSelectedToken] = React.useState<number | null>(null);
  const [focusedChartIndex, setFocusedChartIndex] = React.useState<number | null>(null);
  const focusTimerRef = React.useRef<number | null>(null);

  const [feedHealth, setFeedHealth] = React.useState<Record<number, FeedHealth>>({});
  const staleRef = React.useRef<Record<number, boolean>>({});

  const onFeedHealthReport = React.useCallback(
    (h: FeedHealth) => {
      setFeedHealth((prev) => ({ ...prev, [h.index]: h }));

      const wasStale = staleRef.current[h.index] || false;
      const isStale = Boolean(h.stale);

      if (!wasStale && isStale && h.token !== null) {
        const label = labelForToken(h.token, tokenLabels);
        pushToast("bad", `Stale feed: Chart ${h.index + 1} • ${label} • lag ${fmtLag(h.lagSec)}`);
      }

      staleRef.current[h.index] = isStale;
    },
    [pushToast, tokenLabels],
  );

  const focusToken = React.useCallback(
    (tok: number) => {
      setSelectedToken(tok);
      setBlotterOpen(true);

      let idx = charts.findIndex((c) => Number(c.token) === Number(tok));
      if (idx === -1) idx = 0;

      // If not already on a chart, replace chart 1 (index 0) by default.
      if (charts[idx]?.token !== tok) {
        setCharts((prev) => {
          const cp = [...prev];
          cp[idx] = { ...cp[idx], token: tok };
          return cp;
        });
      }

      setFocusedChartIndex(idx);

      // Scroll to the chart on small screens (best-effort).
      window.setTimeout(() => {
        const el = document.getElementById(`chart-${idx}`);
        el?.scrollIntoView?.({ behavior: "smooth", block: "center" });
      }, 0);

      if (focusTimerRef.current) window.clearTimeout(focusTimerRef.current);
      focusTimerRef.current = window.setTimeout(() => setFocusedChartIndex(null), 2200) as any;
    },
    [charts],
  );

  // auto-assign tokens to empty charts (first 4 subscribed tokens)
  React.useEffect(() => {
    if (!tokens.length) return;
    setCharts((prev) => {
      const next = [...prev];
      const used = new Set(next.map((c) => c.token).filter(Boolean) as number[]);
      for (let i = 0; i < next.length; i += 1) {
        if (next[i].token) continue;
        const pick = tokens.find((t) => !used.has(t));
        if (pick) {
          next[i] = { ...next[i], token: pick };
          used.add(pick);
        }
      }
      return next;
    });
  }, [tokens]);

  // Kite login handshake state (optional)
  const [kiteBusy, setKiteBusy] = React.useState(false);
  const [kiteMsg, setKiteMsg] = React.useState<string | null>(null);
  const [kiteErr, setKiteErr] = React.useState<string | null>(null);
  const [kiteRequestToken, setKiteRequestToken] = React.useState<string | null>(null);
  const [killBusy, setKillBusy] = React.useState(false);

  // If the registered Kite redirect URL points to this FE, Kite will redirect back with `request_token`.
  // We catch it here and hand it to the backend for token exchange (api_secret must stay on server).
  React.useEffect(() => {
    const r = parseKiteRedirect(window.location.search);
    if (!r.ok) return;

    setKiteRequestToken(r.requestToken);
    setKiteBusy(true);
    setKiteMsg(null);
    setKiteErr(null);

    // Clear query params immediately to avoid repeated exchanges on refresh.
    const cleanUrl = `${window.location.origin}${window.location.pathname}${window.location.hash}`;
    window.history.replaceState({}, "", cleanUrl);

    postJson<any>(settings, KITE_SESSION_PATH, {
      request_token: r.requestToken,
    })
      .then((res) => {
        if (res?.ok === false) {
          throw new Error(res?.error || "Kite session exchange failed");
        }
        setKiteMsg("Kite session created on backend");
        setKiteErr(null);
        statusQ.refetch();
      })
      .catch((e: any) => {
        setKiteErr(e?.message || String(e));
        setKiteMsg(null);
      })
      .finally(() => {
        setKiteBusy(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.baseUrl, settings.apiKey]);

  const connected = Boolean(statusQ.data?.ok);
  const halted = Boolean(statusQ.data?.halted || statusQ.data?.killSwitch);
  const hasKiteSession = Boolean(statusQ.data?.ticker?.hasSession);
  const killSwitchEnabled = Boolean(statusQ.data?.killSwitch);

  const save = () => {
    setSettings({
      baseUrl: normalizeBaseUrl(draftBase),
      apiKey: draftKey.trim(),
      kiteApiKey: draftKiteApiKey.trim(),
    });
  };

  const onKiteLogin = () => {
    const apiKey = (draftKiteApiKey || settings.kiteApiKey).trim();
    if (!apiKey) {
      setKiteErr(
        "Missing Kite API key. Add VITE_KITE_API_KEY in your FE .env or enter it in the top bar and click Save.",
      );
      setKiteMsg(null);
      return;
    }
    const loginUrl = buildKiteLoginUrl(apiKey);
    window.open(loginUrl, "_blank");
  };

  const copyRequestToken = async () => {
    if (!kiteRequestToken) return;
    try {
      await navigator.clipboard.writeText(kiteRequestToken);
      setKiteMsg("Copied request_token to clipboard");
    } catch {
      setKiteMsg("Copy failed (browser blocked clipboard)");
    }
  };

  const toggleKillSwitch = async () => {
    if (!connected) {
      pushToast("warn", "Connect to backend before toggling kill switch.");
      return;
    }
    if (killBusy) return;
    const nextEnabled = !killSwitchEnabled;
    setKillBusy(true);
    try {
      const res = await postJson<{ ok?: boolean; kill?: boolean; error?: string }>(
        settings,
        `/admin/kill?enabled=${nextEnabled}`,
      );
      if (res?.ok === false) {
        throw new Error(res?.error || "Kill switch request failed.");
      }
      const nextKill = typeof res?.kill === "boolean" ? res.kill : nextEnabled;
      pushToast(nextKill ? "bad" : "good", nextKill ? "Kill switch enabled." : "Kill switch disabled.");
      statusQ.refetch();
    } catch (err: any) {
      pushToast("bad", err?.message || "Kill switch request failed.");
    } finally {
      setKillBusy(false);
    }
  };

  const staleItems = React.useMemo(() => {
    return Object.values(feedHealth)
      .filter((h) => h.stale && h.token !== null)
      .sort((a, b) => a.index - b.index);
  }, [feedHealth]);

  return (
    <div className="app">
      <div className="topbar">
        <div className="brand">
          <span className={["statusDot", connected ? (halted ? "bad" : "good") : ""].join(" ")} />
          <span>Kite Scalper Dashboard</span>
          <span className="pill">2×2 charts</span>
          <span className="pill">signals → markers (trades)</span>
        </div>

        <div className="controls">
          <div className="field">
            <label>Backend URL</label>
            <input
              value={draftBase}
              onChange={(e) => setDraftBase(e.target.value)}
              placeholder="http://localhost:4001"
            />
          </div>
          <div className="field">
            <label>API key</label>
            <input
              value={draftKey}
              onChange={(e) => setDraftKey(e.target.value)}
              placeholder="x-api-key (optional)"
            />
          </div>
          <div className="field">
            <label>Kite API key</label>
            <input
              className="small"
              value={draftKiteApiKey}
              onChange={(e) => setDraftKiteApiKey(e.target.value)}
              placeholder="kite api_key"
            />
          </div>

          <button className="btn" onClick={save}>
            Save
          </button>

          <button className="btn" type="button" onClick={resetLayout} title="Reset charts + blotter layout to default">
            Reset layout
          </button>

          <button
            className={["btn", killSwitchEnabled ? "danger" : "good"].join(" ")}
            type="button"
            onClick={toggleKillSwitch}
            disabled={killBusy || !connected}
            title="Toggle kill switch on backend"
          >
            {killBusy ? "Updating…" : killSwitchEnabled ? "Disable Kill Switch" : "Enable Kill Switch"}
          </button>

          <span className="pill">{connected ? (halted ? "HALTED / KILL" : "CONNECTED") : "DISCONNECTED"}</span>

          <span className={["pill", hasKiteSession ? "good" : "bad"].join(" ")}>
            {hasKiteSession ? "KITE: LOGGED IN" : "KITE: LOGIN REQUIRED"}
          </span>

          <span
            className={["pill", socketState.connected ? "good" : "warn"].join(" ")}
            title={socketState.lastEvent ? `Last socket event: ${socketState.lastEvent}` : "Socket events pending"}
          >
            {socketState.connected ? "WS: CONNECTED" : "WS: OFFLINE"}
          </span>

          <span className={["pill", socketState.connected ? "good" : "warn"].join(" ")} title="Data source mode">
            DATA: {socketState.connected ? "WS" : "POLL"}
          </span>

          <button className="btn" onClick={() => setBlotterOpen((v) => !v)} title="Toggle trade blotter sidebar">
            {blotterOpen ? "Hide blotter" : "Show blotter"}
          </button>

          <button className="btn" onClick={onKiteLogin} disabled={kiteBusy} title="Opens the official Kite Connect login page">
            {kiteBusy ? "Kite…" : hasKiteSession ? "Re-login Kite" : "Login Kite"}
          </button>

          {kiteRequestToken ? (
            <button className="btn" onClick={copyRequestToken} disabled={kiteBusy} title="Copy request_token (only if redirect_url points to FE)">
              Copy request_token
            </button>
          ) : null}

          {kiteErr ? <span className="pill bad">{kiteErr}</span> : null}
          {!kiteErr && kiteMsg ? <span className="pill good">{kiteMsg}</span> : null}
        </div>
      </div>

      {staleItems.length ? (
        <div className="banner bad">
          <strong>STALE FEED</strong>
          <span className="bannerSep">•</span>
          {staleItems.map((h) => {
            const label = h.token !== null ? labelForToken(h.token, tokenLabels) : "-";
            return (
              <span key={h.index} className="bannerItem" onClick={() => (h.token !== null ? focusToken(h.token) : null)} title="Click to focus chart">
                Chart {h.index + 1}: {label} (lag {fmtLag(h.lagSec)})
              </span>
            );
          })}
        </div>
      ) : null}

      <div className="overview">
        <div className="overviewHeader">
          <div>
            <div className="overviewTitle">Pro Trading Overview</div>
            <div className="overviewSubtitle">Real-time performance, risk, and execution health.</div>
          </div>
          <div className="overviewChips">
            <span className={["pill", connected ? "good" : "bad"].join(" ")}>
              Engine: {connected ? (halted ? "HALTED" : "LIVE") : "OFFLINE"}
            </span>
            <span className={["pill", statusQ.data?.tradingEnabled ? "good" : "warn"].join(" ")}>
              Trading {statusQ.data?.tradingEnabled ? "Enabled" : "Disabled"}
            </span>
            <span className={["pill", statusQ.data?.killSwitch ? "bad" : "good"].join(" ")}>
              Kill Switch {statusQ.data?.killSwitch ? "ON" : "OFF"}
            </span>
          </div>
        </div>

        <div className="overviewTools">
          <div className="rangeControls">
            <div className="field">
              <label>Date range</label>
              <select className="small" value={dateRange} onChange={(e) => setDateRange(e.target.value as DateRangeKey)}>
                {DATE_RANGE_OPTIONS.map((opt) => (
                  <option key={opt.key} value={opt.key}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
            <span className="rangeHint">
              Showing trades updated within {rangeConfig.days ? `last ${rangeConfig.days}d` : "all time"}.
            </span>
          </div>
          <div className="rangeSummary">
            <span className="pill">
              Trades in range: {filteredTradeStats.total} / {allTradeStats.total}
            </span>
            <span className={["pill", filteredTradeStats.pnl >= 0 ? "good" : "bad"].join(" ")}>
              Range P&amp;L {fmtCurrency(filteredTradeStats.pnl)}
            </span>
            <span className={["pill", remainingPnl >= 0 ? "good" : "bad"].join(" ")}>
              Remaining P&amp;L {fmtCurrency(remainingPnl)}
            </span>
            <span className="pill">Outside range: {remainingTradeCount} trades</span>
          </div>
        </div>

        <div className="overviewGrid">
          <div className="metricCard">
            <div className="metricLabel">Realized P&amp;L</div>
            <div className={["metricValue", filteredTradeStats.pnl >= 0 ? "goodText" : "badText"].join(" ")}>
              {fmtCurrency(filteredTradeStats.pnl)}
            </div>
            <div className="metricMeta">
              Closed trades: {filteredTradeStats.closed} • Range: {rangeConfig.label}
            </div>
          </div>
          <div className="metricCard">
            <div className="metricLabel">Win Rate</div>
            <div className="metricValue">{fmtPercent(filteredTradeStats.winRate)}</div>
            <div className="metricMeta">
              Wins: {filteredTradeStats.wins} • Losses: {filteredTradeStats.losses}
            </div>
          </div>
          <div className="metricCard">
            <div className="metricLabel">Avg Hold Time</div>
            <div className="metricValue">
              {filteredTradeStats.avgHoldMin ? `${filteredTradeStats.avgHoldMin.toFixed(1)}m` : "-"}
            </div>
            <div className="metricMeta">Strategy execution speed</div>
          </div>
          <div className="metricCard">
            <div className="metricLabel">Open Exposure</div>
            <div className="metricValue">{fmtCurrency(filteredTradeStats.exposure)}</div>
            <div className="metricMeta">Open trades: {filteredTradeStats.open}</div>
          </div>
          <div className="metricCard">
            <div className="metricLabel">Trades Today</div>
            <div className="metricValue">{fmtCompact(statusQ.data?.tradesToday ?? filteredTradeStats.total)}</div>
            <div className="metricMeta">Orders placed: {fmtCompact(statusQ.data?.ordersPlacedToday ?? 0)}</div>
          </div>
          <div className="metricCard">
            <div className="metricLabel">Feed Health</div>
            <div className="metricValue">{staleItems.length ? "Degraded" : "Healthy"}</div>
            <div className="metricMeta">
              Worst lag:{" "}
              {staleItems.length
                ? fmtLag(staleItems[staleItems.length - 1]?.lagSec ?? null)
                : fmtLag(Math.max(...Object.values(feedHealth).map((h) => h.lagSec || 0), 0))}
            </div>
          </div>
        </div>

        <div className="overviewPanels">
          <div className="panel miniPanel">
            <div className="panelHeader">
              <div className="left">
                <div style={{ fontWeight: 700 }}>Active Trade</div>
                <span className="pill">{statusQ.data?.activeTradeId ? "LIVE" : "NONE"}</span>
              </div>
            </div>
            <div className="panelBody">
              {statusQ.data?.activeTrade ? (
                <div className="stackList">
                  <div>
                    <span className="stackLabel">Instrument</span>
                    <div className="stackValue">
                      {formatPrettyInstrumentFromTradingSymbol(
                        statusQ.data?.activeTrade?.instrument?.tradingsymbol,
                      ) || "-"}
                    </div>
                  </div>
                  <div>
                    <span className="stackLabel">Side</span>
                    <div className="stackValue">{statusQ.data?.activeTrade?.side || "-"}</div>
                  </div>
                  <div>
                    <span className="stackLabel">Entry</span>
                    <div className="stackValue">{fmtNumber(statusQ.data?.activeTrade?.entryPrice)}</div>
                  </div>
                  <div>
                    <span className="stackLabel">Stop / Target</span>
                    <div className="stackValue">
                      {fmtNumber(statusQ.data?.activeTrade?.stopLoss)} /{" "}
                      {fmtNumber(statusQ.data?.activeTrade?.targetPrice)}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="panelPlaceholder">No active trade reported by backend.</div>
              )}
            </div>
          </div>

          <div className="panel miniPanel">
            <div className="panelHeader">
              <div className="left">
                <div style={{ fontWeight: 700 }}>System Health</div>
                <span className={["pill", socketState.connected ? "good" : "warn"].join(" ")}>
                  {socketState.connected ? "WS LIVE" : "POLLING"}
                </span>
              </div>
            </div>
            <div className="panelBody">
              <div className="stackList">
                <div>
                  <span className="stackLabel">Last socket event</span>
                  <div className="stackValue">{socketState.lastEvent || "—"}</div>
                </div>
                <div>
                  <span className="stackLabel">Last disconnect</span>
                  <div className="stackValue">{formatSince(statusQ.data?.ticker?.lastDisconnect)}</div>
                </div>
                <div>
                  <span className="stackLabel">Rejected trades</span>
                  <div className="stackValue">{filteredTradeStats.rejected}</div>
                </div>
              </div>
            </div>
          </div>

          <div className="panel miniPanel">
            <div className="panelHeader">
              <div className="left">
                <div style={{ fontWeight: 700 }}>Strategy Performance</div>
                <span className="pill">Top 6</span>
              </div>
            </div>
            <div className="panelBody">
              {strategyStats.length ? (
                <table className="miniTable">
                  <thead>
                    <tr>
                      <th>Strategy</th>
                      <th>Trades</th>
                      <th>Win %</th>
                      <th>P&amp;L</th>
                    </tr>
                  </thead>
                  <tbody>
                    {strategyStats.map((row) => (
                      <tr key={row.id}>
                        <td className="mono">{row.id}</td>
                        <td className="mono">{row.count}</td>
                        <td className="mono">{fmtPercent(row.winRate)}</td>
                        <td className={["mono", row.pnl >= 0 ? "goodText" : "badText"].join(" ")}>
                          {fmtCurrency(row.pnl)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div className="panelPlaceholder">No strategy stats yet.</div>
              )}
            </div>
          </div>

          <div className="panel miniPanel">
            <div className="panelHeader">
              <div className="left">
                <div style={{ fontWeight: 700 }}>Market Pulse</div>
                <span className="pill">Top symbols</span>
              </div>
            </div>
            <div className="panelBody">
              {instrumentPulse.length ? (
                <div className="pulseList">
                  {instrumentPulse.map((row) => (
                    <div key={row.token} className="pulseRow">
                      <div className="pulseSymbol">{labelForToken(row.token, tokenLabels)}</div>
                      <div className="pulseMeta">{row.count} trades</div>
                      <div className={["pulseValue", row.pnl >= 0 ? "goodText" : "badText"].join(" ")}>
                        {fmtCurrency(row.pnl)}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="panelPlaceholder">Awaiting trade flow.</div>
              )}
            </div>
          </div>

          <div className="panel miniPanel wide">
            <div className="panelHeader">
              <div className="left">
                <div style={{ fontWeight: 700 }}>Activity Feed</div>
                <span className="pill">Latest 6</span>
              </div>
            </div>
            <div className="panelBody">
              {recentActivity.length ? (
                <div className="activityList">
                  {recentActivity.map((row) => (
                    <div key={row.id} className="activityRow">
                      <div className="activityMain">
                        <div className="activityTitle">
                          {labelForToken(row.token, tokenLabels)} • {row.side || "-"}
                        </div>
                        <div className="activityMeta">
                          {row.status || "status n/a"} • {row.updatedAt ? new Date(row.updatedAt).toLocaleString() : "-"}
                        </div>
                      </div>
                      <div className={["activityValue", row.pnl !== null && row.pnl >= 0 ? "goodText" : "badText"].join(" ")}>
                        {row.pnl === null ? "-" : fmtCurrency(row.pnl)}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="panelPlaceholder">No activity yet.</div>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="main">
        <div className="grid">
          {charts.map((cfg, i) => (
            <ChartPanel
              key={i}
              panelId={`chart-${i}`}
              index={i}
              config={cfg}
              tokens={tokens}
              tokenLabels={tokenLabels}
              trades={trades}
              tradesLoading={tradesQ.isFetching}
              socketConnected={socketState.connected}
              serverNowMs={serverNowMs}
              isFocused={focusedChartIndex === i}
              onFeedHealth={onFeedHealthReport}
              onChange={(next) =>
                setCharts((prev) => {
                  const cp = [...prev];
                  cp[i] = next;
                  return cp;
                })
              }
            />
          ))}
        </div>

        {/* Sidebar blotter */}
        <div className={["blotterShell", blotterOpen ? "open" : "closed"].join(" ")}>
          <TradeBlotter
            trades={filteredTrades}
            limit={blotterLimit}
            onLimitChange={setBlotterLimit}
            tokenLabels={tokenLabels}
            selectedToken={selectedToken}
            onSelectToken={(tok) => focusToken(tok)}
            onClose={() => setBlotterOpen(false)}
            rangeLabel={`Range: ${rangeConfig.label}`}
          />
        </div>

        {!blotterOpen ? (
          <button className="blotterHandle" type="button" onClick={() => setBlotterOpen(true)} title="Open trade blotter">
            Blotter
          </button>
        ) : null}

        {/* Toasts */}
        <div className="toastHost" aria-live="polite">
          {toasts.map((t) => (
            <div key={t.id} className={["toast", t.level].join(" ")}>
              <div className="toastMsg">{t.message}</div>
              <button className="toastClose" onClick={() => setToasts((prev) => prev.filter((x) => x.id !== t.id))} title="Dismiss">
                ×
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
