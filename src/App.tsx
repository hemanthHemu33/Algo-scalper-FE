import React from "react";
import { useSettings } from "./lib/settingsContext";
import { useStatus, useSubscriptions, useTradesRecent } from "./lib/hooks";
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
            trades={trades}
            limit={blotterLimit}
            onLimitChange={setBlotterLimit}
            tokenLabels={tokenLabels}
            selectedToken={selectedToken}
            onSelectToken={(tok) => focusToken(tok)}
            onClose={() => setBlotterOpen(false)}
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
