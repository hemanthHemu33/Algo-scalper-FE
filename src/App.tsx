import React from "react";
import { useQuery } from "@tanstack/react-query";
import { useSettings } from "./lib/settingsContext";
import {
  useAuditLogs,
  useAlertChannels,
  useAlertIncidents,
  useCostCalibration,
  useCriticalHealth,
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
import { getJson, postJson } from "./lib/http";
import { buildKiteLoginUrl, parseKiteRedirect } from "./lib/kiteAuth";
import {
  ChartPanel,
  type ChartConfig,
  type FeedHealth,
} from "./components/ChartPanel";
import { TradeBlotter } from "./components/TradeBlotter";
import { getIstDayStartMs } from "./lib/chartUtils";
import { useSocketBridge } from "./lib/socket";
import {
  formatPrettyInstrumentFromTrade,
  formatPrettyInstrumentFromTradingSymbol,
} from "./lib/instrumentFormat";
import type { TradeRow } from "./types/backend";

type ToastLevel = "good" | "warn" | "bad";
type Toast = {
  id: string;
  level: ToastLevel;
  message: string;
  createdAt: number;
};

const LAYOUT_KEY = "kite_scalper_dashboard_layout_v1";

type SavedLayout = {
  charts?: ChartConfig[];
  blotterLimit?: 20 | 50;
  blotterOpen?: boolean;
};

type DateRangeKey = "1D" | "7D" | "30D" | "90D" | "LAST" | "ALL";
type IntegrationCheck = {
  id: string;
  label: string;
  endpoint: string;
  query: any;
  count: (data: any) => number | null;
};

const DATE_RANGE_OPTIONS: Array<{
  key: DateRangeKey;
  label: string;
  days: number | null;
}> = [
  { key: "1D", label: "1D", days: 1 },
  { key: "7D", label: "7D", days: 7 },
  { key: "30D", label: "30D", days: 30 },
  { key: "90D", label: "90D", days: 90 },
  { key: "LAST", label: "Last trading day", days: null },
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

function fmtBool(value: boolean | null | undefined) {
  if (value === true) return "YES";
  if (value === false) return "NO";
  return "-";
}

function formatUpdatedAt(updatedAt: number | null | undefined) {
  if (!updatedAt) return "-";
  const date = new Date(updatedAt);
  if (!Number.isFinite(date.getTime())) return "-";
  return date.toLocaleTimeString();
}

function formatQueryError(err: unknown) {
  if (!err) return "-";
  if (typeof err === "string") return err;
  if (err instanceof Error) return err.message || "Unknown error";
  if (typeof err === "object" && "message" in (err as any)) {
    return String((err as any).message);
  }
  try {
    return JSON.stringify(err);
  } catch {
    return "Unknown error";
  }
}

function extractNumericSeries(
  value: unknown,
  prefix = "",
  out: Array<{ key: string; value: number }> = [],
) {
  if (out.length >= 30) return out;
  if (typeof value === "number" && Number.isFinite(value)) {
    out.push({ key: prefix || "value", value });
    return out;
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) {
      extractNumericSeries(value[i], `${prefix}[${i}]`, out);
      if (out.length >= 30) break;
    }
    return out;
  }
  if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const next = prefix ? `${prefix}.${k}` : k;
      extractNumericSeries(v, next, out);
      if (out.length >= 30) break;
    }
  }
  return out;
}

function humanizePathLabel(path: string) {
  if (!path) return "Value";
  return path
    .replace(/\[(\d+)\]/g, " item $1")
    .split(".")
    .filter(Boolean)
    .map((part) =>
      part
        .replace(/([a-z\d])([A-Z])/g, "$1 $2")
        .replace(/[_-]+/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .replace(/^\w/, (char) => char.toUpperCase()),
    )
    .join(" → ");
}

function describeDataShape(value: unknown) {
  if (value === null || value === undefined) return "No data";
  if (Array.isArray(value)) return `List (${value.length} items)`;
  if (typeof value === "object") return "Details object";
  return `Single ${typeof value} value`;
}

function summarizeArrays(value: unknown) {
  const out: Array<{ key: string; size: number }> = [];
  if (!value || typeof value !== "object") return out;
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    if (Array.isArray(v)) out.push({ key, size: v.length });
  }
  return out.slice(0, 10);
}

function toEpochMs(value: any): number | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    if (value < 1e12) return value * 1000;
    return value;
  }
  if (typeof value === "string") {
    const parsed = new Date(value).getTime();
    if (Number.isFinite(parsed)) return parsed;
    const num = Number(value);
    if (Number.isFinite(num)) return num < 1e12 ? num * 1000 : num;
  }
  return null;
}

function pickTimeStopMs(trade: any): number | null {
  if (!trade) return null;
  const keys = [
    "timeStopAt",
    "timeStopAtMs",
    "timeStopAtTs",
    "timeStopAtIso",
    "timeStopMs",
  ];
  for (const key of keys) {
    const ms = toEpochMs(trade?.[key]);
    if (Number.isFinite(ms as number)) return ms as number;
  }
  return null;
}

function formatCountdown(targetMs: number | null, nowMs: number) {
  if (!Number.isFinite(targetMs as number)) return "-";
  const diff = Number(targetMs) - nowMs;
  if (!Number.isFinite(diff)) return "-";
  if (diff <= 0) return "0s";
  const totalSec = Math.ceil(diff / 1000);
  const hours = Math.floor(totalSec / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

function pickTelemetryValue(
  data: Record<string, any> | null | undefined,
  keys: string[],
) {
  if (!data) return null;
  for (const key of keys) {
    const value = data[key];
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return null;
}

function fmtTelemetryValue(value: any) {
  if (value === null || value === undefined || value === "") return "-";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    const raw = JSON.stringify(value);
    return raw.length > 140 ? `${raw.slice(0, 140)}…` : raw;
  } catch {
    return String(value);
  }
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

function formatAgoMs(ms: number | null | undefined, nowMs: number) {
  if (!Number.isFinite(ms as number)) return "-";
  const diff = Math.max(0, nowMs - Number(ms));
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hours = Math.floor(min / 60);
  const minutes = min % 60;
  if (hours < 24) return `${hours}h ${minutes}m`;
  const days = Math.floor(hours / 24);
  const remH = hours % 24;
  return `${days}d ${remH}h`;
}

function formatIstDate(ms: number | null | undefined) {
  if (!Number.isFinite(ms as number)) return "-";
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: IST_TZ,
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(Number(ms)));
}

function formatIstDateTime(ms: number | null | undefined, withSeconds = false) {
  if (!Number.isFinite(ms as number)) return "-";
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: IST_TZ,
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: withSeconds ? "2-digit" : undefined,
    hour12: false,
  }).format(new Date(Number(ms)));
}

function severityClass(sev?: string) {
  const s = (sev || "").toLowerCase();
  if (s.includes("crit") || s.includes("high") || s.includes("sev"))
    return "bad";
  if (s.includes("warn")) return "warn";
  if (s.includes("info") || s.includes("low")) return "good";
  return "";
}

function statusBucket(status?: string) {
  const s = (status || "").toUpperCase();
  if (s.includes("OPEN") || s.includes("ACTIVE")) return "open";
  if (s.includes("CLOSED") || s.includes("DONE") || s.includes("EXIT"))
    return "closed";
  if (s.includes("REJECT") || s.includes("CANCEL") || s.includes("FAIL"))
    return "rejected";
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
    if (
      Number.isFinite(qty) &&
      Number.isFinite(entry) &&
      Number.isFinite(exit)
    ) {
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

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const IST_TZ = "Asia/Kolkata";

const TIME_BUCKETS: Array<{ label: string; start: number; end: number }> = [
  { label: "09:15–09:30", start: 9 * 60 + 15, end: 9 * 60 + 30 },
  { label: "09:30–11:00", start: 9 * 60 + 30, end: 11 * 60 },
  { label: "11:00–13:30", start: 11 * 60, end: 13 * 60 + 30 },
  { label: "13:30–15:30", start: 13 * 60 + 30, end: 15 * 60 + 30 },
  { label: "15:30+", start: 15 * 60 + 30, end: 24 * 60 },
];

const PREMIUM_BANDS: Array<{ label: string; min: number; max: number }> = [
  { label: "<80", min: 0, max: 80 },
  { label: "80–120", min: 80, max: 120 },
  { label: "120–200", min: 120, max: 200 },
  { label: "200–350", min: 200, max: 350 },
  { label: "350+", min: 350, max: Number.POSITIVE_INFINITY },
];

const HOLD_BUCKETS: Array<{ label: string; min: number; max: number }> = [
  { label: "<2m", min: 0, max: 2 },
  { label: "2–5m", min: 2, max: 5 },
  { label: "5–15m", min: 5, max: 15 },
  { label: "15–30m", min: 15, max: 30 },
  { label: "30–60m", min: 30, max: 60 },
  { label: "60m+", min: 60, max: Number.POSITIVE_INFINITY },
];

function pickTradeNumber(row: TradeRow, keys: string[]) {
  const rec = row as Record<string, any>;
  for (const key of keys) {
    const value = rec[key];
    if (value !== undefined && value !== null && value !== "") {
      const num = Number(value);
      if (Number.isFinite(num)) return num;
    }
  }
  return null;
}

function tradePnl(row: TradeRow) {
  const qty = Number(row.qty);
  const entry = Number(row.entryPrice);
  const exit = Number(row.exitPrice);
  const side = (row.side || "").toUpperCase();
  if (
    !Number.isFinite(qty) ||
    !Number.isFinite(entry) ||
    !Number.isFinite(exit)
  )
    return null;
  return side === "SELL" ? (entry - exit) * qty : (exit - entry) * qty;
}

function tradeRisk(row: TradeRow) {
  const qty = Number(row.qty);
  const entry = Number(row.entryPrice);
  const stop = Number(row.stopLoss);
  const side = (row.side || "").toUpperCase();
  if (
    !Number.isFinite(qty) ||
    !Number.isFinite(entry) ||
    !Number.isFinite(stop)
  )
    return null;
  const perUnit = side === "SELL" ? stop - entry : entry - stop;
  if (!Number.isFinite(perUnit) || perUnit <= 0) return null;
  return perUnit * qty;
}

function tradeR(row: TradeRow) {
  const pnl = tradePnl(row);
  const risk = tradeRisk(row);
  if (!Number.isFinite(pnl as number) || !Number.isFinite(risk as number))
    return null;
  return (pnl as number) / (risk as number);
}

function tradeHoldMin(row: TradeRow) {
  const start = row.createdAt ? new Date(row.createdAt).getTime() : NaN;
  const end = row.updatedAt ? new Date(row.updatedAt).getTime() : NaN;
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start)
    return null;
  return (end - start) / 60000;
}

function tradeTimeBucket(row: TradeRow) {
  const ts = row.createdAt || row.updatedAt;
  if (!ts) return "Unknown";
  const ms = new Date(ts).getTime();
  if (!Number.isFinite(ms)) return "Unknown";
  const ist = new Date(ms + IST_OFFSET_MS);
  const minutes = ist.getUTCHours() * 60 + ist.getUTCMinutes();
  for (const bucket of TIME_BUCKETS) {
    if (minutes >= bucket.start && minutes < bucket.end) return bucket.label;
  }
  return "Unknown";
}

function tradeRegime(row: TradeRow) {
  const rec = row as Record<string, any>;
  return (
    rec.regime ||
    rec.marketRegime ||
    rec.regimeLabel ||
    rec.regime_state ||
    "UNKNOWN"
  );
}

function tradePremiumBand(row: TradeRow) {
  const premium =
    pickTradeNumber(row, [
      "premium",
      "entryPremium",
      "entry_premium",
      "entryPrice",
    ]) ?? null;
  if (!Number.isFinite(premium as number)) return "Unknown";
  for (const band of PREMIUM_BANDS) {
    if ((premium as number) >= band.min && (premium as number) < band.max)
      return band.label;
  }
  return "Unknown";
}

type TruthMetrics = {
  count: number;
  wins: number;
  pnlSum: number;
  rSum: number;
  rCount: number;
  rWinSum: number;
  rWinCount: number;
  rLossSum: number;
  rLossCount: number;
  slippageSum: number;
  slippageCount: number;
  spreadSum: number;
  spreadCount: number;
  maeSum: number;
  maeCount: number;
  mfeSum: number;
  mfeCount: number;
  holdSum: number;
  holdCount: number;
};

function initTruthMetrics(): TruthMetrics {
  return {
    count: 0,
    wins: 0,
    pnlSum: 0,
    rSum: 0,
    rCount: 0,
    rWinSum: 0,
    rWinCount: 0,
    rLossSum: 0,
    rLossCount: 0,
    slippageSum: 0,
    slippageCount: 0,
    spreadSum: 0,
    spreadCount: 0,
    maeSum: 0,
    maeCount: 0,
    mfeSum: 0,
    mfeCount: 0,
    holdSum: 0,
    holdCount: 0,
  };
}

function applyTradeMetrics(metrics: TruthMetrics, row: TradeRow) {
  metrics.count += 1;

  const pnl = tradePnl(row);
  if (Number.isFinite(pnl as number)) {
    metrics.pnlSum += pnl as number;
    if ((pnl as number) >= 0) metrics.wins += 1;
  }

  const r = tradeR(row);
  if (Number.isFinite(r as number)) {
    metrics.rSum += r as number;
    metrics.rCount += 1;
    if ((r as number) >= 0) {
      metrics.rWinSum += r as number;
      metrics.rWinCount += 1;
    } else {
      metrics.rLossSum += r as number;
      metrics.rLossCount += 1;
    }
  }

  const entrySlip = pickTradeNumber(row, [
    "entrySlippage",
    "slippageEntry",
    "slippage_entry",
  ]);
  const exitSlip = pickTradeNumber(row, [
    "exitSlippage",
    "slippageExit",
    "slippage_exit",
  ]);
  const totalSlip =
    pickTradeNumber(row, ["slippage", "totalSlippage", "slippageTotal"]) ??
    (Number.isFinite(entrySlip as number) || Number.isFinite(exitSlip as number)
      ? (entrySlip || 0) + (exitSlip || 0)
      : null);

  if (Number.isFinite(totalSlip as number)) {
    metrics.slippageSum += totalSlip as number;
    metrics.slippageCount += 1;
  }

  const spread = pickTradeNumber(row, [
    "entrySpread",
    "spreadAtEntry",
    "entry_spread",
    "spread",
  ]);
  if (Number.isFinite(spread as number)) {
    metrics.spreadSum += spread as number;
    metrics.spreadCount += 1;
  }

  const mae = pickTradeNumber(row, [
    "mae",
    "MAE",
    "maxAdverseExcursion",
    "max_adverse_excursion",
  ]);
  if (Number.isFinite(mae as number)) {
    metrics.maeSum += mae as number;
    metrics.maeCount += 1;
  }

  const mfe = pickTradeNumber(row, [
    "mfe",
    "MFE",
    "maxFavorableExcursion",
    "max_favorable_excursion",
  ]);
  if (Number.isFinite(mfe as number)) {
    metrics.mfeSum += mfe as number;
    metrics.mfeCount += 1;
  }

  const hold = tradeHoldMin(row);
  if (Number.isFinite(hold as number)) {
    metrics.holdSum += hold as number;
    metrics.holdCount += 1;
  }
}

function buildTruthSummary(metrics: TruthMetrics) {
  const winRate = metrics.count
    ? (metrics.wins / metrics.count) * 100
    : null;
  const avgR = metrics.rCount ? metrics.rSum / metrics.rCount : null;
  const avgWinR = metrics.rWinCount ? metrics.rWinSum / metrics.rWinCount : null;
  const avgLossR =
    metrics.rLossCount ? metrics.rLossSum / metrics.rLossCount : null;
  const expectancy =
    avgWinR !== null && avgLossR !== null && winRate !== null
      ? (winRate / 100) * avgWinR + (1 - winRate / 100) * avgLossR
      : null;
  return {
    count: metrics.count,
    winRate,
    avgR,
    expectancy,
    avgSlippage: metrics.slippageCount
      ? metrics.slippageSum / metrics.slippageCount
      : null,
    avgSpread: metrics.spreadCount
      ? metrics.spreadSum / metrics.spreadCount
      : null,
    avgMae: metrics.maeCount ? metrics.maeSum / metrics.maeCount : null,
    avgMfe: metrics.mfeCount ? metrics.mfeSum / metrics.mfeCount : null,
    avgHoldMin: metrics.holdCount ? metrics.holdSum / metrics.holdCount : null,
  };
}

function buildTruthGroups(
  rows: TradeRow[],
  keyFn: (row: TradeRow) => string,
) {
  const map = new Map<string, TruthMetrics>();
  for (const row of rows) {
    const key = keyFn(row);
    if (!map.has(key)) map.set(key, initTruthMetrics());
    applyTradeMetrics(map.get(key)!, row);
  }
  return Array.from(map.entries()).map(([key, metrics]) => ({
    key,
    ...buildTruthSummary(metrics),
  }));
}

export default function App() {
  const { settings, setSettings } = useSettings();
  const [draftBase, setDraftBase] = React.useState(settings.baseUrl);
  const [draftKey, setDraftKey] = React.useState(settings.apiKey);
  const [draftKiteApiKey, setDraftKiteApiKey] = React.useState(
    settings.kiteApiKey,
  );
  const [showConnectionSettings, setShowConnectionSettings] = React.useState(false);
  const [showSecretKeys, setShowSecretKeys] = React.useState(false);

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
  const wsPoll = socketState.connected ? false : undefined;

  const readinessQ = useQuery({
    queryKey: ["ready", settings.baseUrl, settings.apiKey],
    queryFn: () => getJson<Record<string, unknown>>(settings, "/ready"),
    refetchInterval: wsPoll ?? 10000,
    retry: false,
  });
  const configQ = useQuery({
    queryKey: ["config", settings.baseUrl, settings.apiKey],
    queryFn: () => getJson<Record<string, unknown>>(settings, "/admin/config"),
    refetchInterval: wsPoll ?? 30000,
    retry: false,
  });
  const tradingToggleQ = useQuery({
    queryKey: ["trading", settings.baseUrl, settings.apiKey],
    queryFn: () => getJson<Record<string, unknown>>(settings, "/admin/trading"),
    refetchInterval: wsPoll ?? 12000,
    retry: false,
  });
  const retentionQ = useQuery({
    queryKey: ["retention", settings.baseUrl, settings.apiKey],
    queryFn: () => getJson<Record<string, unknown>>(settings, "/admin/db/retention"),
    refetchInterval: wsPoll ?? 30000,
    retry: false,
  });
  const rbacQ = useQuery({
    queryKey: ["rbac", settings.baseUrl, settings.apiKey],
    queryFn: () => getJson<Record<string, unknown>>(settings, "/admin/rbac"),
    refetchInterval: wsPoll ?? 30000,
    retry: false,
  });

  const statusQ = useStatus(wsPoll ?? 2000);
  const subsQ = useSubscriptions(wsPoll ?? 5000);
  // Fetch a bigger window so token→symbol learning covers more instruments.
  const tradesQ = useTradesRecent(200, wsPoll ?? 2000);
  const equityQ = useEquity(wsPoll ?? 6000);
  const positionsQ = usePositions(wsPoll ?? 8000);
  const ordersQ = useOrders(wsPoll ?? 8000);
  const riskQ = useRiskLimits(wsPoll ?? 10000);
  const strategyKpisQ = useStrategyKpis(wsPoll ?? 12000);
  const executionQ = useExecutionQuality(wsPoll ?? 12000);
  const marketHealthQ = useMarketHealth(wsPoll ?? 8000);
  const auditLogsQ = useAuditLogs(wsPoll ?? 20000);
  const alertChannelsQ = useAlertChannels(wsPoll ?? 20000);
  const alertIncidentsQ = useAlertIncidents(wsPoll ?? 15000);
  const telemetryQ = useTelemetrySnapshot(wsPoll ?? 20000);
  const tradeTelemetryQ = useTradeTelemetrySnapshot(wsPoll ?? 20000);
  const optimizerQ = useOptimizerSnapshot(wsPoll ?? 20000);
  const rejectionsQ = useRejections(wsPoll ?? 20000);
  const costCalibQ = useCostCalibration(wsPoll ?? 30000);
  const calendarQ = useMarketCalendar(wsPoll ?? 30000);
  const fnoQ = useFnoUniverse(wsPoll ?? 60000);
  const criticalHealthQ = useCriticalHealth(wsPoll ?? 12000);

  const integrationChecks = React.useMemo<IntegrationCheck[]>(
    () => [
      {
        id: "ready",
        label: "Readiness",
        endpoint: "/ready",
        query: readinessQ,
        count: (data: any) => (data ? 1 : 0),
      },
      {
        id: "status",
        label: "Engine status",
        endpoint: "/admin/status",
        query: statusQ,
        count: (data: any) => (data ? 1 : 0),
      },
      {
        id: "config",
        label: "Config",
        endpoint: "/admin/config",
        query: configQ,
        count: (data: any) => Object.keys(data ?? {}).length,
      },
      {
        id: "trading",
        label: "Trading toggle",
        endpoint: "/admin/trading",
        query: tradingToggleQ,
        count: (data: any) => (data ? 1 : 0),
      },
      {
        id: "subscriptions",
        label: "Subscriptions",
        endpoint: "/admin/subscriptions",
        query: subsQ,
        count: (data: any) => data?.tokens?.length ?? 0,
      },
      {
        id: "trades",
        label: "Recent trades",
        endpoint: "/admin/trades/recent",
        query: tradesQ,
        count: (data: any) => data?.rows?.length ?? 0,
      },
      {
        id: "equity",
        label: "Equity snapshot",
        endpoint: "/admin/account/equity",
        query: equityQ,
        count: (data: any) => (data ? 1 : 0),
      },
      {
        id: "positions",
        label: "Positions",
        endpoint: "/admin/positions",
        query: positionsQ,
        count: (data: any) => data?.rows?.length ?? 0,
      },
      {
        id: "orders",
        label: "Orders",
        endpoint: "/admin/orders",
        query: ordersQ,
        count: (data: any) => data?.rows?.length ?? 0,
      },
      {
        id: "risk",
        label: "Risk limits",
        endpoint: "/admin/risk/limits",
        query: riskQ,
        count: (data: any) => (data ? 1 : 0),
      },
      {
        id: "strategy-kpis",
        label: "Strategy KPIs",
        endpoint: "/admin/strategy/kpis",
        query: strategyKpisQ,
        count: (data: any) => data?.rows?.length ?? 0,
      },
      {
        id: "execution-quality",
        label: "Execution quality",
        endpoint: "/admin/execution/quality",
        query: executionQ,
        count: (data: any) => data?.rows?.length ?? 0,
      },
      {
        id: "market-health",
        label: "Market health",
        endpoint: "/admin/market/health",
        query: marketHealthQ,
        count: (data: any) => data?.tokens?.length ?? 0,
      },
      {
        id: "audit-logs",
        label: "Audit logs",
        endpoint: "/admin/audit/logs",
        query: auditLogsQ,
        count: (data: any) => data?.rows?.length ?? 0,
      },
      {
        id: "alert-channels",
        label: "Alert channels",
        endpoint: "/admin/alerts/channels",
        query: alertChannelsQ,
        count: (data: any) => data?.rows?.length ?? 0,
      },
      {
        id: "alert-incidents",
        label: "Alert incidents",
        endpoint: "/admin/alerts/incidents",
        query: alertIncidentsQ,
        count: (data: any) => data?.rows?.length ?? 0,
      },
      {
        id: "telemetry",
        label: "Telemetry snapshot",
        endpoint: "/admin/telemetry/snapshot",
        query: telemetryQ,
        count: (data: any) => Object.keys(data?.data ?? {}).length,
      },
      {
        id: "trade-telemetry",
        label: "Trade telemetry",
        endpoint: "/admin/trade-telemetry/snapshot",
        query: tradeTelemetryQ,
        count: (data: any) => Object.keys(data?.data ?? {}).length,
      },
      {
        id: "optimizer",
        label: "Optimizer snapshot",
        endpoint: "/admin/optimizer/snapshot",
        query: optimizerQ,
        count: (data: any) => Object.keys(data?.data ?? {}).length,
      },
      {
        id: "rejections",
        label: "Rejections",
        endpoint: "/admin/rejections",
        query: rejectionsQ,
        count: (data: any) => Object.keys(data?.data ?? {}).length,
      },
      {
        id: "cost-calibration",
        label: "Cost calibration",
        endpoint: "/admin/cost/calibration",
        query: costCalibQ,
        count: (data: any) =>
          Object.keys(data?.calibration ?? {}).length ||
          (data?.recentRuns?.length ?? 0),
      },
      {
        id: "calendar",
        label: "Market calendar",
        endpoint: "/admin/market/calendar",
        query: calendarQ,
        count: (data: any) => Object.keys(data?.meta ?? {}).length,
      },
      {
        id: "retention",
        label: "DB retention",
        endpoint: "/admin/db/retention",
        query: retentionQ,
        count: (data: any) => Object.keys(data ?? {}).length,
      },
      {
        id: "rbac",
        label: "RBAC",
        endpoint: "/admin/rbac",
        query: rbacQ,
        count: (data: any) => Object.keys(data ?? {}).length,
      },
      {
        id: "fno",
        label: "FNO universe",
        endpoint: "/admin/fno",
        query: fnoQ,
        count: (data: any) => Object.keys(data?.universe ?? {}).length,
      },
      {
        id: "critical-health",
        label: "Critical health",
        endpoint: "/admin/health/critical",
        query: criticalHealthQ,
        count: (data: any) => data?.checks?.length ?? 0,
      },
    ],
    [
      readinessQ,
      statusQ,
      configQ,
      tradingToggleQ,
      subsQ,
      tradesQ,
      equityQ,
      positionsQ,
      ordersQ,
      riskQ,
      strategyKpisQ,
      executionQ,
      marketHealthQ,
      auditLogsQ,
      alertChannelsQ,
      alertIncidentsQ,
      telemetryQ,
      tradeTelemetryQ,
      optimizerQ,
      rejectionsQ,
      costCalibQ,
      calendarQ,
      retentionQ,
      rbacQ,
      fnoQ,
      criticalHealthQ,
    ],
  );

  const [activeIntegration, setActiveIntegration] = React.useState<IntegrationCheck | null>(null);
  const [integrationDetail, setIntegrationDetail] = React.useState<{
    loading: boolean;
    data: unknown;
    error: string | null;
    updatedAt: number | null;
  }>({ loading: false, data: null, error: null, updatedAt: null });

  const refreshIntegrationDetail = React.useCallback(async () => {
    if (!activeIntegration) return;
    setIntegrationDetail((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const data = await getJson<unknown>(settings, activeIntegration.endpoint);
      setIntegrationDetail({
        loading: false,
        data,
        error: null,
        updatedAt: Date.now(),
      });
    } catch (err) {
      setIntegrationDetail({
        loading: false,
        data: null,
        error: formatQueryError(err),
        updatedAt: Date.now(),
      });
    }
  }, [activeIntegration, settings]);

  React.useEffect(() => {
    if (!activeIntegration) return;
    setIntegrationDetail({
      loading: false,
      data: activeIntegration.query?.data ?? null,
      error:
        activeIntegration.query?.status === "error"
          ? formatQueryError(activeIntegration.query?.error)
          : null,
      updatedAt: activeIntegration.query?.dataUpdatedAt || null,
    });
    void refreshIntegrationDetail();
  }, [activeIntegration, refreshIntegrationDetail]);

  React.useEffect(() => {
    if (!activeIntegration) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setActiveIntegration(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activeIntegration]);

  const refetchIntegration = React.useCallback(() => {
    integrationChecks.forEach((check) => {
      check.query?.refetch?.();
    });
  }, [integrationChecks]);

  const tokens: number[] = subsQ.data?.tokens || [];
  const trades = tradesQ.data?.rows || [];
  const alertChannels = alertChannelsQ.data?.rows || [];
  const alertIncidents = alertIncidentsQ.data?.rows || [];
  const riskLimits = riskQ.data;
  const executionQuality = executionQ.data;
  const tradeTelemetry = tradeTelemetryQ.data?.data || null;

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

  const [nowMs, setNowMs] = React.useState(() => Date.now());
  React.useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  const serverOffsetMs = React.useMemo(() => serverNowMs - Date.now(), [serverNowMs]);
  const currentMs = nowMs + serverOffsetMs;

  const activeTrade = statusQ.data?.activeTrade;
  const timeStopMs = React.useMemo(
    () => pickTimeStopMs(activeTrade),
    [activeTrade],
  );
  const timeStopCountdown = React.useMemo(
    () => formatCountdown(timeStopMs, currentMs),
    [timeStopMs, currentMs],
  );

  const [feedHealth, setFeedHealth] = React.useState<Record<number, FeedHealth>>(
    {},
  );
  const staleRef = React.useRef<Record<number, boolean>>({});
  const [dateRange, setDateRange] = React.useState<DateRangeKey>("1D");

  const rangeConfig = React.useMemo(
    () =>
      DATE_RANGE_OPTIONS.find((opt) => opt.key === dateRange) ||
      DATE_RANGE_OPTIONS[0],
    [dateRange],
  );

  const latestTradeMs = React.useMemo(() => {
    let max = Number.NEGATIVE_INFINITY;
    for (const t of trades || []) {
      const ts = new Date(t.updatedAt || t.createdAt || "").getTime();
      if (Number.isFinite(ts)) max = Math.max(max, ts);
    }
    return Number.isFinite(max) ? max : null;
  }, [trades]);

  const latestFeedMs = React.useMemo(() => {
    let max = Number.NEGATIVE_INFINITY;
    for (const h of Object.values(feedHealth)) {
      const ts = h.lastTs ? new Date(h.lastTs).getTime() : NaN;
      if (Number.isFinite(ts)) max = Math.max(max, ts);
    }
    return Number.isFinite(max) ? max : null;
  }, [feedHealth]);

  const latestDataMs = React.useMemo(() => {
    const max = Math.max(
      Number.isFinite(latestTradeMs as number) ? (latestTradeMs as number) : NaN,
      Number.isFinite(latestFeedMs as number) ? (latestFeedMs as number) : NaN,
    );
    return Number.isFinite(max) ? max : null;
  }, [latestFeedMs, latestTradeMs]);

  const latestDataDayStartMs = React.useMemo(() => {
    if (!Number.isFinite(latestDataMs as number)) return null;
    return getIstDayStartMs(Number(latestDataMs));
  }, [latestDataMs]);

  const currentDayStartMs = React.useMemo(
    () => getIstDayStartMs(serverNowMs),
    [serverNowMs],
  );

  const dataDayStatus = React.useMemo(() => {
    if (!Number.isFinite(latestDataMs as number)) {
      return { label: "NO DATA", tone: "bad" };
    }
    if (latestDataDayStartMs === currentDayStartMs) {
      return { label: "LIVE", tone: "good" };
    }
    return { label: "LAST", tone: "warn" };
  }, [currentDayStartMs, latestDataDayStartMs, latestDataMs]);

  const rangeWindow = React.useMemo(() => {
    if (rangeConfig.key === "LAST") {
      if (!Number.isFinite(latestDataDayStartMs as number)) {
        return { start: null, end: null };
      }
      return {
        start: latestDataDayStartMs,
        end: Number(latestDataDayStartMs) + 24 * 60 * 60 * 1000,
      };
    }
    if (!rangeConfig.days) return { start: null, end: null };
    return {
      start: serverNowMs - rangeConfig.days * 24 * 60 * 60 * 1000,
      end: serverNowMs,
    };
  }, [rangeConfig.days, rangeConfig.key, latestDataDayStartMs, serverNowMs]);

  const rangeLabel = React.useMemo(() => {
    if (
      rangeConfig.key === "LAST" &&
      Number.isFinite(latestDataDayStartMs as number)
    ) {
      return `${rangeConfig.label} (${formatIstDate(latestDataDayStartMs)})`;
    }
    return rangeConfig.label;
  }, [latestDataDayStartMs, rangeConfig.key, rangeConfig.label]);

  const rangeHint = React.useMemo(() => {
    if (rangeConfig.key === "LAST") {
      return Number.isFinite(latestDataDayStartMs as number)
        ? `last trading day (${formatIstDate(latestDataDayStartMs)})`
        : "last trading day";
    }
    if (rangeConfig.days) return `last ${rangeConfig.days}d`;
    return "all time";
  }, [latestDataDayStartMs, rangeConfig.days, rangeConfig.key]);

  const filteredTrades = React.useMemo(() => {
    const start = rangeWindow.start;
    const end = rangeWindow.end;
    if (start == null) return trades;
    return (trades || []).filter((t) => {
      const ts = new Date(t.updatedAt || t.createdAt || "").getTime();
      if (!Number.isFinite(ts)) return false;
      if (end && ts >= end) return false;
      return ts >= start;
    });
  }, [rangeWindow.end, rangeWindow.start, trades]);

  const filteredAlertIncidents = React.useMemo(() => {
    const start = rangeWindow.start;
    const end = rangeWindow.end;
    if (start == null) return alertIncidents;
    return (alertIncidents || []).filter((incident) => {
      const ts = new Date(incident.createdAt || "").getTime();
      if (!Number.isFinite(ts)) return false;
      if (end && ts >= end) return false;
      return ts >= start;
    });
  }, [alertIncidents, rangeWindow.end, rangeWindow.start]);

  const alertIncidentStats = React.useMemo(() => {
    const counts = {
      total: 0,
      critical: 0,
      high: 0,
      warn: 0,
      info: 0,
      other: 0,
    };
    for (const incident of filteredAlertIncidents || []) {
      counts.total += 1;
      const sev = (incident.severity || "").toLowerCase();
      if (sev.includes("crit")) counts.critical += 1;
      else if (sev.includes("high")) counts.high += 1;
      else if (sev.includes("warn")) counts.warn += 1;
      else if (sev.includes("info") || sev.includes("low")) counts.info += 1;
      else counts.other += 1;
    }
    return counts;
  }, [filteredAlertIncidents]);

  const alertChannelStats = React.useMemo(() => {
    const total = alertChannels.length;
    const enabled = alertChannels.filter((channel) => channel.enabled).length;
    return { total, enabled, disabled: Math.max(0, total - enabled) };
  }, [alertChannels]);

  const recentAlertIncidents = React.useMemo(() => {
    return [...(filteredAlertIncidents || [])]
      .sort((a, b) => {
        const ta = new Date(a.createdAt || 0).getTime();
        const tb = new Date(b.createdAt || 0).getTime();
        return tb - ta;
      })
      .slice(0, 5);
  }, [filteredAlertIncidents]);

  const filteredTradeStats = React.useMemo(
    () => calcTradeStats(filteredTrades),
    [filteredTrades],
  );
  const allTradeStats = React.useMemo(() => calcTradeStats(trades), [trades]);

  const remainingTradeCount = Math.max(
    0,
    allTradeStats.total - filteredTradeStats.total,
  );
  const remainingPnl = allTradeStats.pnl - filteredTradeStats.pnl;

  const tradeTracking = React.useMemo(() => {
    const targetMode = pickTelemetryValue(tradeTelemetry, [
      "OPT_TARGET_MODE",
      "optTargetMode",
      "targetMode",
      "target_mode",
    ]);
    const targetStatus = pickTelemetryValue(tradeTelemetry, [
      "targetStatus",
      "target_state",
      "targetPending",
      "pendingTarget",
      "targetPendingState",
    ]);
    const stopMode = pickTelemetryValue(tradeTelemetry, [
      "OPT_SL_MODE",
      "optSlMode",
      "slMode",
      "stopMode",
      "stop_mode",
    ]);
    const trackerStatus = pickTelemetryValue(tradeTelemetry, [
      "trackingStatus",
      "tradeTracking",
      "trackingState",
      "tradeTracker",
      "tracker",
    ]);
    const lastEvent = pickTelemetryValue(tradeTelemetry, [
      "lastEvent",
      "lastAction",
      "last_update",
      "lastUpdate",
      "event",
    ]);
    const lastUpdated = pickTelemetryValue(tradeTelemetry, [
      "updatedAt",
      "asOf",
      "timestamp",
      "ts",
    ]);

    return {
      targetMode,
      targetStatus,
      stopMode,
      trackerStatus,
      lastEvent,
      lastUpdated,
    };
  }, [tradeTelemetry]);

  const strategyStats = React.useMemo(() => {
    const map = new Map<
      string,
      { id: string; count: number; wins: number; pnl: number }
    >();
    for (const t of filteredTrades || []) {
      const id = t.strategyId || "unassigned";
      if (!map.has(id)) map.set(id, { id, count: 0, wins: 0, pnl: 0 });
      const row = map.get(id)!;
      row.count += 1;
      const qty = Number(t.qty);
      const entry = Number(t.entryPrice);
      const exit = Number(t.exitPrice);
      const side = (t.side || "").toUpperCase();
      if (
        Number.isFinite(qty) &&
        Number.isFinite(entry) &&
        Number.isFinite(exit)
      ) {
        const raw =
          side === "SELL" ? (entry - exit) * qty : (exit - entry) * qty;
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
    const map = new Map<
      number,
      { token: number; count: number; pnl: number }
    >();
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
      if (
        Number.isFinite(qty) &&
        Number.isFinite(entry) &&
        Number.isFinite(exit)
      ) {
        const raw =
          side === "SELL" ? (entry - exit) * qty : (exit - entry) * qty;
        row.pnl += raw;
      }
    }
    return Array.from(map.values())
      .sort((a, b) => b.pnl - a.pnl)
      .slice(0, 5);
  }, [filteredTrades]);

  const truthSummary = React.useMemo(() => {
    const metrics = initTruthMetrics();
    for (const row of filteredTrades || []) {
      applyTradeMetrics(metrics, row);
    }
    return buildTruthSummary(metrics);
  }, [filteredTrades]);

  const truthByStrategy = React.useMemo(() => {
    return buildTruthGroups(filteredTrades || [], (row) =>
      row.strategyId ? String(row.strategyId) : "unassigned",
    ).sort((a, b) => (b.expectancy ?? -Infinity) - (a.expectancy ?? -Infinity));
  }, [filteredTrades]);

  const truthByRegime = React.useMemo(() => {
    return buildTruthGroups(filteredTrades || [], (row) =>
      String(tradeRegime(row)).toUpperCase(),
    ).sort((a, b) => (b.expectancy ?? -Infinity) - (a.expectancy ?? -Infinity));
  }, [filteredTrades]);

  const truthByTimeBucket = React.useMemo(() => {
    const rows = buildTruthGroups(filteredTrades || [], tradeTimeBucket);
    const order = new Map(TIME_BUCKETS.map((b, idx) => [b.label, idx]));
    return rows.sort(
      (a, b) => (order.get(a.key) ?? 99) - (order.get(b.key) ?? 99),
    );
  }, [filteredTrades]);

  const truthByPremiumBand = React.useMemo(() => {
    const rows = buildTruthGroups(filteredTrades || [], tradePremiumBand);
    const order = new Map(PREMIUM_BANDS.map((b, idx) => [b.label, idx]));
    return rows.sort(
      (a, b) => (order.get(a.key) ?? 99) - (order.get(b.key) ?? 99),
    );
  }, [filteredTrades]);

  const truthByStrategyRegime = React.useMemo(() => {
    return buildTruthGroups(filteredTrades || [], (row) => {
      const strat = row.strategyId ? String(row.strategyId) : "unassigned";
      const regime = String(tradeRegime(row)).toUpperCase();
      return `${strat} • ${regime}`;
    }).sort((a, b) => (b.expectancy ?? -Infinity) - (a.expectancy ?? -Infinity));
  }, [filteredTrades]);

  const truthPerTrade = React.useMemo(() => {
    return [...(filteredTrades || [])]
      .sort((a, b) => {
        const ta = new Date(a.updatedAt || a.createdAt || 0).getTime();
        const tb = new Date(b.updatedAt || b.createdAt || 0).getTime();
        return tb - ta;
      })
      .slice(0, 8)
      .map((row) => ({
        id: row.tradeId,
        strategy: row.strategyId || "unassigned",
        regime: String(tradeRegime(row)).toUpperCase(),
        r: tradeR(row),
        slippage: (() => {
          const total = pickTradeNumber(row, ["slippage", "totalSlippage"]);
          if (Number.isFinite(total as number)) return total;
          const entry = pickTradeNumber(row, ["entrySlippage", "slippageEntry"]);
          const exit = pickTradeNumber(row, ["exitSlippage", "slippageExit"]);
          if (
            !Number.isFinite(entry as number) &&
            !Number.isFinite(exit as number)
          )
            return null;
          return (entry || 0) + (exit || 0);
        })(),
        spread: pickTradeNumber(row, [
          "entrySpread",
          "spreadAtEntry",
          "spread",
        ]),
        mae: pickTradeNumber(row, ["mae", "MAE", "maxAdverseExcursion"]),
        mfe: pickTradeNumber(row, ["mfe", "MFE", "maxFavorableExcursion"]),
        holdMin: tradeHoldMin(row),
      }));
  }, [filteredTrades]);

  const truthHoldDistribution = React.useMemo(() => {
    const counts = HOLD_BUCKETS.map((bucket) => ({
      label: bucket.label,
      count: 0,
    }));
    for (const row of filteredTrades || []) {
      const hold = tradeHoldMin(row);
      if (!Number.isFinite(hold as number)) continue;
      const idx = HOLD_BUCKETS.findIndex(
        (b) => (hold as number) >= b.min && (hold as number) < b.max,
      );
      if (idx >= 0) counts[idx].count += 1;
    }
    const total = counts.reduce((sum, row) => sum + row.count, 0);
    return counts.map((row) => ({
      ...row,
      pct: total ? (row.count / total) * 100 : 0,
    }));
  }, [filteredTrades]);

  const truthCostInsight = React.useMemo(() => {
    const wins = initTruthMetrics();
    const losses = initTruthMetrics();
    for (const row of filteredTrades || []) {
      const pnl = tradePnl(row);
      if (Number.isFinite(pnl as number)) {
        if ((pnl as number) >= 0) applyTradeMetrics(wins, row);
        else applyTradeMetrics(losses, row);
      }
    }
    const winSummary = buildTruthSummary(wins);
    const lossSummary = buildTruthSummary(losses);
    let verdict = "Signal edge + costs";
    if (
      winSummary.avgSlippage !== null &&
      lossSummary.avgSlippage !== null &&
      winSummary.avgSpread !== null &&
      lossSummary.avgSpread !== null
    ) {
      if (
        lossSummary.avgSlippage > winSummary.avgSlippage &&
        lossSummary.avgSpread > winSummary.avgSpread
      ) {
        verdict = "Costs (spread + slippage)";
      } else if (lossSummary.avgSlippage > winSummary.avgSlippage) {
        verdict = "Slippage-heavy";
      } else if (lossSummary.avgSpread > winSummary.avgSpread) {
        verdict = "Wide spreads";
      } else {
        verdict = "Signal edge";
      }
    }
    return { winSummary, lossSummary, verdict };
  }, [filteredTrades]);

  const truthReportLines = React.useMemo(() => {
    const eligible = truthByStrategyRegime.filter((row) => row.count >= 3);
    if (!eligible.length) return [];
    const best = eligible[0];
    const worst = eligible[eligible.length - 1];
    return [
      `${best.key} is ${fmtNumber(best.expectancy, 2)}R`,
      `${worst.key} is ${fmtNumber(worst.expectancy, 2)}R`,
      `Loss driver: ${truthCostInsight.verdict}`,
    ];
  }, [truthByStrategyRegime, truthCostInsight.verdict]);

  const recentActivity = React.useMemo(() => {
    return (filteredTrades || []).slice(0, 6).map((t) => ({
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
        if (
          Number.isFinite(qty) &&
          Number.isFinite(entry) &&
          Number.isFinite(exit)
        ) {
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
    [],
  );

  const [charts, setCharts] = React.useState<ChartConfig[]>(() => {
    const c = saved.charts;
    if (Array.isArray(c) && c.length === 4) {
      return c.map((x) => ({
        token: x?.token ?? null,
        intervalMin: Number(x?.intervalMin || 1),
      })) as any;
    }
    return defaultCharts;
  });

  const [blotterLimit, setBlotterLimit] = React.useState<20 | 50>(() =>
    saved.blotterLimit === 50 ? 50 : 20,
  );
  const [menuOpen, setMenuOpen] = React.useState(false);
  const menuRef = React.useRef<HTMLDivElement | null>(null);
  const [blotterOpen, setBlotterOpen] = React.useState(() =>
    saved.blotterOpen === false ? false : true,
  );

  React.useEffect(() => {
    if (!menuOpen) return;
    const onDown = (event: MouseEvent) => {
      if (!menuRef.current) return;
      if (menuRef.current.contains(event.target as Node)) return;
      setMenuOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [menuOpen]);

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
  const [focusedChartIndex, setFocusedChartIndex] = React.useState<
    number | null
  >(null);
  const focusTimerRef = React.useRef<number | null>(null);

  const onFeedHealthReport = React.useCallback(
    (h: FeedHealth) => {
      setFeedHealth((prev) => ({ ...prev, [h.index]: h }));

      const wasStale = staleRef.current[h.index] || false;
      const isStale = Boolean(h.stale);

      if (!wasStale && isStale && h.token !== null) {
        const label = labelForToken(h.token, tokenLabels);
        pushToast(
          "bad",
          `Stale feed: Chart ${h.index + 1} • ${label} • lag ${fmtLag(h.lagSec)}`,
        );
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
      focusTimerRef.current = window.setTimeout(
        () => setFocusedChartIndex(null),
        2200,
      ) as any;
    },
    [charts],
  );

  // auto-assign tokens to empty charts (first 4 subscribed tokens)
  React.useEffect(() => {
    if (!tokens.length) return;
    setCharts((prev) => {
      const next = [...prev];
      const used = new Set(
        next.map((c) => c.token).filter(Boolean) as number[],
      );
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
  const [kiteRequestToken, setKiteRequestToken] = React.useState<string | null>(
    null,
  );
  const [killBusy, setKillBusy] = React.useState(false);
  const [tradingBusy, setTradingBusy] = React.useState(false);
  const [actionBusy, setActionBusy] = React.useState<Record<string, boolean>>(
    {},
  );

  const runAction = React.useCallback(
    async <T,>(
      key: string,
      label: string,
      fn: () => Promise<T>,
      onSuccess?: (res: T) => void,
    ) => {
      setActionBusy((prev) => ({ ...prev, [key]: true }));
      try {
        const res: any = await fn();
        if (res?.ok === false) {
          throw new Error(res?.error || `${label} failed`);
        }
        onSuccess?.(res as T);
        pushToast("good", `${label} completed`);
      } catch (e: any) {
        pushToast("bad", `${label} failed: ${e?.message || String(e)}`);
      } finally {
        setActionBusy((prev) => ({ ...prev, [key]: false }));
      }
    },
    [pushToast],
  );

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
  const tradingEnabled = Boolean(statusQ.data?.tradingEnabled);
  const dailyState = statusQ.data?.state;
  const dailyStateClass =
    dailyState === "HARD_STOP"
      ? "bad"
      : dailyState === "SOFT_STOP"
        ? "warn"
        : dailyState === "RUNNING"
          ? "good"
          : "";

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
      const res = await postJson<{
        ok?: boolean;
        kill?: boolean;
        error?: string;
      }>(settings, `/admin/kill?enabled=${nextEnabled}`);
      if (res?.ok === false) {
        throw new Error(res?.error || "Kill switch request failed.");
      }
      const nextKill = typeof res?.kill === "boolean" ? res.kill : nextEnabled;
      pushToast(
        nextKill ? "bad" : "good",
        nextKill ? "Kill switch enabled." : "Kill switch disabled.",
      );
      statusQ.refetch();
    } catch (err: any) {
      pushToast("bad", err?.message || "Kill switch request failed.");
    } finally {
      setKillBusy(false);
    }
  };

  const toggleTrading = async () => {
    if (!connected) {
      pushToast("warn", "Connect to backend before toggling trading.");
      return;
    }
    if (tradingBusy) return;
    const nextEnabled = !tradingEnabled;
    setTradingBusy(true);
    try {
      const res = await postJson<{
        ok?: boolean;
        enabled?: boolean;
        tradingEnabled?: boolean;
        error?: string;
      }>(settings, `/admin/trading?enabled=${nextEnabled}`);
      if (res?.ok === false) {
        throw new Error(res?.error || "Trading toggle request failed.");
      }
      const nextTrading =
        typeof res?.tradingEnabled === "boolean"
          ? res.tradingEnabled
          : typeof res?.enabled === "boolean"
            ? res.enabled
            : nextEnabled;
      pushToast(
        nextTrading ? "good" : "warn",
        nextTrading ? "Trading enabled." : "Trading disabled.",
      );
      statusQ.refetch();
    } catch (err: any) {
      pushToast("bad", err?.message || "Trading toggle request failed.");
    } finally {
      setTradingBusy(false);
    }
  };

  const criticalChecks = criticalHealthQ.data?.checks || [];
  const criticalFails = criticalChecks.filter((c) => !c.ok);
  const criticalOk = criticalHealthQ.data?.ok ?? null;

  const handleHaltReset = () =>
    runAction(
      "haltReset",
      "Reset halt",
      () => postJson(settings, "/admin/halt/reset"),
      () => statusQ.refetch(),
    );

  const handleCalendarReload = () =>
    runAction(
      "calendarReload",
      "Reload market calendar",
      () => postJson(settings, "/admin/market/calendar/reload"),
      () => calendarQ.refetch(),
    );

  const handleRetentionEnsure = () =>
    runAction("retentionEnsure", "Ensure DB retention indexes", () =>
      postJson(settings, "/admin/db/retention/ensure"),
    );

  const handleCostCalibrationReload = () =>
    runAction(
      "costCalibrationReload",
      "Reload cost calibration",
      () => postJson(settings, "/admin/cost/calibration/reload"),
      () => costCalibQ.refetch(),
    );

  const handleOptimizerReload = () =>
    runAction(
      "optimizerReload",
      "Reload optimizer",
      () => postJson(settings, "/admin/optimizer/reload"),
      () => optimizerQ.refetch(),
    );

  const handleOptimizerFlush = () =>
    runAction(
      "optimizerFlush",
      "Flush optimizer",
      () => postJson(settings, "/admin/optimizer/flush"),
      () => optimizerQ.refetch(),
    );

  const handleOptimizerReset = () =>
    runAction(
      "optimizerReset",
      "Reset optimizer",
      () => postJson(settings, "/admin/optimizer/reset"),
      () => optimizerQ.refetch(),
    );

  const handleTelemetryFlush = () =>
    runAction(
      "telemetryFlush",
      "Flush telemetry",
      () => postJson(settings, "/admin/telemetry/flush"),
      () => telemetryQ.refetch(),
    );

  const handleTradeTelemetryFlush = () =>
    runAction(
      "tradeTelemetryFlush",
      "Flush trade telemetry",
      () => postJson(settings, "/admin/trade-telemetry/flush"),
      () => tradeTelemetryQ.refetch(),
    );

  const handleAlertsTest = () =>
    runAction("alertsTest", "Send test alert", () =>
      postJson(settings, "/admin/alerts/test", {
        type: "test",
        message: "Dashboard test alert",
        severity: "info",
      }),
    );

  const handleDbPurge = () => {
    console.clear();
    console.log(
      "%cDATABASE PURGE INITIATED",
      "color: red; font-size: 20px; font-weight: bold;",
    );
    if (!connected) {
      pushToast("warn", "Connect to backend before purging the database.");
      return;
    }
    const confirmation = window.prompt(
      'This will delete Mongo data. Type "PURGE" to confirm.',
    );
    if (confirmation !== "PURGE") {
      pushToast("warn", "Database purge cancelled.");
      return;
    }
    runAction("dbPurge", "Purge database", () =>
      postJson(settings, "/admin/db/purge", { confirm: "PURGE" }),
    );
  };

  const staleItems = React.useMemo(() => {
    return Object.values(feedHealth)
      .filter((h) => h.stale && h.token !== null)
      .sort((a, b) => a.index - b.index);
  }, [feedHealth]);

  return (
    <div className="app">
      <div className="topbar">
        <div className="topbarMain">
          <div className="brand">
            <span
              className={[
                "statusDot",
                connected ? (halted ? "bad" : "good") : "",
              ].join(" ")}
            />
            <div className="brandText">
              <div className="brandTitle">Kite Scalper Dashboard</div>
              <div className="brandSubtitle">
                2×2 charts • signals → markers (trades)
              </div>
            </div>
          </div>

          <div className="controls headerStatusRow">
            <span className="pill">
              {connected
                ? halted
                  ? "HALTED / KILL"
                  : "CONNECTED"
                : "DISCONNECTED"}
            </span>
            <span className={["pill", hasKiteSession ? "good" : "bad"].join(" ")}>
              {hasKiteSession ? "KITE: LOGGED IN" : "KITE: LOGIN REQUIRED"}
            </span>
            <span
              className={["pill", socketState.connected ? "good" : "warn"].join(
                " ",
              )}
              title={
                socketState.lastEvent
                  ? `Last socket event: ${socketState.lastEvent}`
                  : "Socket events pending"
              }
            >
              {socketState.connected ? "WS: CONNECTED" : "WS: OFFLINE"}
            </span>
            <span
              className={["pill", socketState.connected ? "good" : "warn"].join(
                " ",
              )}
              title="Data source mode"
            >
              DATA: {socketState.connected ? "WS" : "POLL"}
            </span>
          </div>

          <div className="headerMenuWrap" ref={menuRef}>
            <button
              className="btn menuToggle"
              type="button"
              onClick={() => setMenuOpen((v) => !v)}
              title="Open dashboard actions"
            >
              ☰ Actions
            </button>
            {menuOpen ? (
              <div className="controls headerActionRow">
                <button
                  className="btn"
                  type="button"
                  onClick={() => {
                    setShowConnectionSettings((v) => !v);
                    setMenuOpen(false);
                  }}
                  title="Show/hide backend and key settings"
                >
                  ⚙️ {showConnectionSettings ? "Hide Settings" : "Show Settings"}
                </button>
                <button
                  className="btn"
                  onClick={() => {
                    setBlotterOpen((v) => !v);
                    setMenuOpen(false);
                  }}
                  title="Toggle trade blotter sidebar"
                >
                  📒 {blotterOpen ? "Hide blotter" : "Show blotter"}
                </button>
                <button
                  className="btn"
                  onClick={onKiteLogin}
                  disabled={kiteBusy}
                  title="Opens the official Kite Connect login page"
                >
                  🔐 {kiteBusy
                    ? "Kite…"
                    : hasKiteSession
                      ? "Re-login Kite"
                      : "Login Kite"}
                </button>
                <button
                  className="btn"
                  type="button"
                  onClick={resetLayout}
                  title="Reset charts + blotter layout to default"
                >
                  🧩 Reset layout
                </button>
                <button
                  className={[
                    "btn",
                    killSwitchEnabled ? "danger" : "good",
                  ].join(" ")}
                  type="button"
                  onClick={toggleKillSwitch}
                  disabled={killBusy || !connected}
                  title="Toggle kill switch on backend"
                >
                  {killBusy
                    ? "Updating…"
                    : killSwitchEnabled
                      ? "🛑 Disable Kill Switch"
                      : "✅ Enable Kill Switch"}
                </button>
                <button
                  className={[
                    "btn",
                    tradingEnabled ? "good" : "warn",
                  ].join(" ")}
                  type="button"
                  onClick={toggleTrading}
                  disabled={tradingBusy || !connected}
                  title="Toggle trading on backend"
                >
                  {tradingBusy
                    ? "Updating…"
                    : tradingEnabled
                      ? "📈 Disable Trading"
                      : "▶️ Enable Trading"}
                </button>
                <button
                  className="btn danger"
                  onClick={handleDbPurge}
                  title="Delete Mongo data via /admin/db/purge"
                >
                  🗑 Purge DB
                </button>
                {kiteRequestToken ? (
                  <button
                    className="btn"
                    onClick={copyRequestToken}
                    disabled={kiteBusy}
                    title="Copy request_token (only if redirect_url points to FE)"
                  >
                    📋 Copy request_token
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
        <div className="controls headerInfoRow">
          {kiteErr ? <span className="pill bad">{kiteErr}</span> : null}
          {!kiteErr && kiteMsg ? <span className="pill good">{kiteMsg}</span> : null}
        </div>

        {showConnectionSettings ? (
          <div className="controls settingsRow">
            <div className="field">
              <label>Backend URL</label>
              <input
                value={draftBase}
                onChange={(e) => setDraftBase(e.target.value)}
                placeholder="http://localhost:4001"
              />
            </div>
            <button
              className="btn small"
              type="button"
              onClick={() => setShowSecretKeys((v) => !v)}
              title="Toggle API key visibility"
            >
              {showSecretKeys ? "🙈 Hide Keys" : "👁 Show Keys"}
            </button>
            <div className="field">
              <label>API key</label>
              <input
                type={showSecretKeys ? "text" : "password"}
                value={draftKey}
                onChange={(e) => setDraftKey(e.target.value)}
                placeholder="x-api-key (optional)"
              />
            </div>
            <div className="field">
              <label>Kite API key</label>
              <input
                className="small"
                type={showSecretKeys ? "text" : "password"}
                value={draftKiteApiKey}
                onChange={(e) => setDraftKiteApiKey(e.target.value)}
                placeholder="kite api_key"
              />
            </div>
            <button className="btn" onClick={save}>
              Save
            </button>
          </div>
        ) : null}
      </div>

      {staleItems.length ? (
        <div className="banner bad">
          <strong>STALE FEED</strong>
          <span className="bannerSep">•</span>
          {staleItems.map((h) => {
            const label =
              h.token !== null ? labelForToken(h.token, tokenLabels) : "-";
            return (
              <span
                key={h.index}
                className="bannerItem"
                onClick={() => (h.token !== null ? focusToken(h.token) : null)}
                title="Click to focus chart"
              >
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
            <div className="overviewSubtitle">
              Real-time performance, risk, and execution health.
            </div>
          </div>
          <div className="overviewChips">
            <span className={["pill", connected ? "good" : "bad"].join(" ")}>
              Engine: {connected ? (halted ? "HALTED" : "LIVE") : "OFFLINE"}
            </span>
            <span
              className={[
                "pill",
                statusQ.data?.tradingEnabled ? "good" : "warn",
              ].join(" ")}
            >
              Trading {statusQ.data?.tradingEnabled ? "Enabled" : "Disabled"}
            </span>
            <span
              className={[
                "pill",
                statusQ.data?.killSwitch ? "bad" : "good",
              ].join(" ")}
            >
              Kill Switch {statusQ.data?.killSwitch ? "ON" : "OFF"}
            </span>
          </div>
        </div>

        <div className="overviewTools">
          <div className="rangeControls">
            <div className="field">
              <label>Date range</label>
              <select
                className="small"
                value={dateRange}
                onChange={(e) => setDateRange(e.target.value as DateRangeKey)}
              >
                {DATE_RANGE_OPTIONS.map((opt) => (
                  <option key={opt.key} value={opt.key}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
            <span className="rangeHint">
              Showing trades updated within{" "}
              {rangeHint}.
            </span>
          </div>
          <div className="rangeSummary">
            <span className="pill">
              Trades in range: {filteredTradeStats.total} /{" "}
              {allTradeStats.total}
            </span>
            <span
              className={[
                "pill",
                filteredTradeStats.pnl >= 0 ? "good" : "bad",
              ].join(" ")}
            >
              Range P&amp;L {fmtCurrency(filteredTradeStats.pnl)}
            </span>
            <span
              className={["pill", remainingPnl >= 0 ? "good" : "bad"].join(" ")}
            >
              Remaining P&amp;L {fmtCurrency(remainingPnl)}
            </span>
            <span className="pill">
              Outside range: {remainingTradeCount} trades
            </span>
          </div>
          <div className="dataFreshness">
            <span className="dataFreshnessLabel">Data freshness</span>
            <span
              className={["pill", dataDayStatus.tone].join(" ")}
              title={
                latestDataMs
                  ? `Latest data: ${formatIstDateTime(latestDataMs, true)}`
                  : "No data received yet"
              }
            >
              Data day: {dataDayStatus.label}
            </span>
            <span
              className="pill"
              title={
                latestTradeMs
                  ? `Last trade update: ${formatIstDateTime(latestTradeMs, true)}`
                  : "No trades received yet"
              }
            >
              Latest trade: {formatAgoMs(latestTradeMs, currentMs)}
            </span>
            <span
              className="pill"
              title={
                latestFeedMs
                  ? `Last candle update: ${formatIstDateTime(latestFeedMs, true)}`
                  : "No candle data received yet"
              }
            >
              Latest candle: {formatAgoMs(latestFeedMs, currentMs)}
            </span>
            <span className="pill" title="Server time (IST)">
              Server: {formatIstDateTime(serverNowMs)}
            </span>
          </div>
        </div>

        <div className="overviewGrid">
          <div className="metricCard">
            <div className="metricLabel">💰 Realized P&amp;L</div>
            <div
              className={[
                "metricValue",
                filteredTradeStats.pnl >= 0 ? "goodText" : "badText",
              ].join(" ")}
            >
              {fmtCurrency(filteredTradeStats.pnl)}
            </div>
            <div className="metricMeta">
              Closed trades: {filteredTradeStats.closed} • Range:{" "}
              {rangeLabel}
            </div>
          </div>
          <div className="metricCard">
            <div className="metricLabel">🎯 Win Rate</div>
            <div className="metricValue">
              {fmtPercent(filteredTradeStats.winRate)}
            </div>
            <div className="metricMeta">
              Wins: {filteredTradeStats.wins} • Losses:{" "}
              {filteredTradeStats.losses}
            </div>
          </div>
          <div className="metricCard">
            <div className="metricLabel">⏱ Avg Hold Time</div>
            <div className="metricValue">
              {filteredTradeStats.avgHoldMin
                ? `${filteredTradeStats.avgHoldMin.toFixed(1)}m`
                : "-"}
            </div>
            <div className="metricMeta">Strategy execution speed</div>
          </div>
          <div className="metricCard">
            <div className="metricLabel">📊 Open Exposure</div>
            <div className="metricValue">
              {fmtCurrency(filteredTradeStats.exposure)}
            </div>
            <div className="metricMeta">
              Open trades: {filteredTradeStats.open}
            </div>
          </div>
          <div className="metricCard">
            <div className="metricLabel">🔁 Trades Today</div>
            <div className="metricValue">
              {fmtCompact(
                statusQ.data?.tradesToday ?? filteredTradeStats.total,
              )}
            </div>
            <div className="metricMeta">
              Orders placed: {fmtCompact(statusQ.data?.ordersPlacedToday ?? 0)}
            </div>
          </div>
          <div className="metricCard">
            <div className="metricLabel">📅 Daily P&amp;L</div>
            <div
              className={[
                "metricValue",
                (statusQ.data?.dailyPnL ?? 0) >= 0 ? "goodText" : "badText",
              ].join(" ")}
            >
              {fmtCurrency(statusQ.data?.dailyPnL)}
            </div>
            <div className="metricMeta">
              State: {dailyState || "-"}
            </div>
          </div>
          <div className="metricCard">
            <div className="metricLabel">🚦 Run State</div>
            <div className="metricValue">
              <span className={["pill", dailyStateClass].join(" ")}>
                {dailyState || "-"}
              </span>
            </div>
            <div className="metricMeta">Daily stop status</div>
          </div>
          <div className="metricCard">
            <div className="metricLabel">📡 Feed Health</div>
            <div className="metricValue">
              {staleItems.length ? "Degraded" : "Healthy"}
            </div>
            <div className="metricMeta">
              Worst lag:{" "}
              {staleItems.length
                ? fmtLag(staleItems[staleItems.length - 1]?.lagSec ?? null)
                : fmtLag(
                    Math.max(
                      ...Object.values(feedHealth).map((h) => h.lagSec || 0),
                      0,
                    ),
                  )}
            </div>
          </div>
        </div>

        <div className="overviewPanels">
          <div className="panel miniPanel">
            <div className="panelHeader">
              <div className="left">
                <div style={{ fontWeight: 700 }}>🧾 Active Trade</div>
                <span className="pill">
                  {statusQ.data?.activeTradeId ? "LIVE" : "NONE"}
                </span>
              </div>
            </div>
            <div className="panelBody">
              {activeTrade ? (
                <div className="stackList">
                  <div>
                    <span className="stackLabel">Instrument</span>
                    <div className="stackValue">
                      {formatPrettyInstrumentFromTradingSymbol(
                        activeTrade?.instrument?.tradingsymbol,
                      ) || "-"}
                    </div>
                  </div>
                  <div>
                    <span className="stackLabel">Side</span>
                    <div className="stackValue">
                      {activeTrade?.side || "-"}
                    </div>
                  </div>
                  <div>
                    <span className="stackLabel">Entry</span>
                    <div className="stackValue">
                      {fmtNumber(activeTrade?.entryPrice)}
                    </div>
                  </div>
                  <div>
                    <span className="stackLabel">Stop / Target</span>
                    <div className="stackValue">
                      {fmtNumber(activeTrade?.stopLoss)} /{" "}
                      {fmtNumber(activeTrade?.targetPrice)}
                    </div>
                  </div>
                  <div>
                    <span className="stackLabel">SL trigger</span>
                    <div className="stackValue">
                      {fmtNumber(activeTrade?.slTrigger)}
                    </div>
                  </div>
                  <div>
                    <span className="stackLabel">Min green (INR)</span>
                    <div className="stackValue">
                      {fmtCurrency(activeTrade?.minGreenInr)}
                    </div>
                  </div>
                  <div>
                    <span className="stackLabel">Min green (pts)</span>
                    <div className="stackValue">
                      {fmtNumber(activeTrade?.minGreenPts)}
                    </div>
                  </div>
                  <div>
                    <span className="stackLabel">BE locked</span>
                    <div className="stackValue">
                      {fmtBool(activeTrade?.beLocked)}
                    </div>
                  </div>
                  <div>
                    <span className="stackLabel">Peak LTP</span>
                    <div className="stackValue">
                      {fmtNumber(activeTrade?.peakLtp)}
                    </div>
                  </div>
                  <div>
                    <span className="stackLabel">Trail SL</span>
                    <div className="stackValue">
                      {fmtNumber(activeTrade?.trailSl)}
                    </div>
                  </div>
                  <div>
                    <span className="stackLabel">Time-stop</span>
                    <div className="stackValue">{timeStopCountdown}</div>
                  </div>
                </div>
              ) : (
                <div className="panelPlaceholder">
                  No active trade reported by backend.
                </div>
              )}
            </div>
          </div>

          <div className="panel miniPanel">
            <div className="panelHeader">
              <div className="left">
                <div style={{ fontWeight: 700 }}>Trade Tracking</div>
                <span
                  className={[
                    "pill",
                    tradeTelemetryQ.data?.ok ? "good" : "warn",
                  ].join(" ")}
                >
                  {tradeTelemetryQ.data?.ok ? "SNAPSHOT OK" : "NO SNAPSHOT"}
                </span>
              </div>
            </div>
            <div className="panelBody">
              {tradeTelemetry ? (
                <div className="stackList">
                  <div>
                    <span className="stackLabel">Tracker</span>
                    <div className="stackValue">
                      {fmtTelemetryValue(tradeTracking.trackerStatus)}
                    </div>
                  </div>
                  <div>
                    <span className="stackLabel">Target mode</span>
                    <div className="stackValue">
                      {fmtTelemetryValue(tradeTracking.targetMode)}
                    </div>
                  </div>
                  <div>
                    <span className="stackLabel">Target status</span>
                    <div className="stackValue">
                      {fmtTelemetryValue(tradeTracking.targetStatus)}
                    </div>
                  </div>
                  <div>
                    <span className="stackLabel">Stop mode</span>
                    <div className="stackValue">
                      {fmtTelemetryValue(tradeTracking.stopMode)}
                    </div>
                  </div>
                  <div>
                    <span className="stackLabel">Last event</span>
                    <div className="stackValue">
                      {fmtTelemetryValue(tradeTracking.lastEvent)}
                    </div>
                  </div>
                  <div>
                    <span className="stackLabel">Last update</span>
                    <div className="stackValue">
                      {fmtTelemetryValue(tradeTracking.lastUpdated)}
                    </div>
                  </div>
                  <div>
                    <span className="stackLabel">Active trade</span>
                    <div className="stackValue">
                      {statusQ.data?.activeTradeId || "-"}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="panelPlaceholder">
                  No trade telemetry snapshot yet.
                </div>
              )}
            </div>
          </div>

          <div className="panel miniPanel">
            <div className="panelHeader">
              <div className="left">
                <div style={{ fontWeight: 700 }}>System Health</div>
                <span
                  className={[
                    "pill",
                    socketState.connected ? "good" : "warn",
                  ].join(" ")}
                >
                  {socketState.connected ? "WS LIVE" : "POLLING"}
                </span>
              </div>
            </div>
            <div className="panelBody">
              <div className="stackList">
                <div>
                  <span className="stackLabel">Last socket event</span>
                  <div className="stackValue">
                    {socketState.lastEvent || "—"}
                  </div>
                </div>
                <div>
                  <span className="stackLabel">Last disconnect</span>
                  <div className="stackValue">
                    {formatSince(statusQ.data?.ticker?.lastDisconnect)}
                  </div>
                </div>
                <div>
                  <span className="stackLabel">Rejected trades</span>
                  <div className="stackValue">
                    {filteredTradeStats.rejected}
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="panel miniPanel">
            <div className="panelHeader">
              <div className="left">
                <div style={{ fontWeight: 700 }}>Risk Limits</div>
                <span className="pill">Portfolio</span>
              </div>
            </div>
            <div className="panelBody">
              {riskLimits ? (
                <div className="stackList">
                  <div>
                    <span className="stackLabel">Max daily loss</span>
                    <div className="stackValue">
                      {fmtCurrency(riskLimits.maxDailyLoss ?? null)}
                    </div>
                  </div>
                  <div>
                    <span className="stackLabel">Max drawdown</span>
                    <div className="stackValue">
                      {fmtCurrency(riskLimits.maxDrawdown ?? null)}
                    </div>
                  </div>
                  <div>
                    <span className="stackLabel">Max open trades</span>
                    <div className="stackValue">
                      {fmtNumber(riskLimits.maxOpenTrades ?? null, 0)}
                    </div>
                  </div>
                  <div>
                    <span className="stackLabel">Max exposure</span>
                    <div className="stackValue">
                      {fmtCurrency(riskLimits.maxExposureInr ?? null)}
                    </div>
                  </div>
                  <div>
                    <span className="stackLabel">Open positions</span>
                    <div className="stackValue">
                      {fmtNumber(riskLimits.usage?.openPositions ?? null, 0)}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="panelPlaceholder">
                  Risk limits not available yet.
                </div>
              )}
            </div>
          </div>

          <div className="panel miniPanel">
            <div className="panelHeader">
              <div className="left">
                <div style={{ fontWeight: 700 }}>⚡ Execution Quality</div>
                <span className="pill">Recent</span>
              </div>
            </div>
            <div className="panelBody">
              {executionQuality ? (
                <div className="stackList">
                  <div>
                    <span className="stackLabel">Fill rate</span>
                    <div className="stackValue">
                      {fmtPercent(executionQuality.fillRate ?? null)}
                    </div>
                  </div>
                  <div>
                    <span className="stackLabel">Avg slippage</span>
                    <div className="stackValue">
                      {fmtNumber(executionQuality.avgSlippage ?? null)}
                    </div>
                  </div>
                  <div>
                    <span className="stackLabel">Avg latency</span>
                    <div className="stackValue">
                      {Number.isFinite(executionQuality.avgLatencyMs)
                        ? `${fmtNumber(executionQuality.avgLatencyMs ?? null, 0)} ms`
                        : "-"}
                    </div>
                  </div>
                  <div>
                    <span className="stackLabel">Rejects</span>
                    <div className="stackValue">
                      {fmtNumber(executionQuality.rejects ?? null, 0)}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="panelPlaceholder">
                  Execution stats not available yet.
                </div>
              )}
            </div>
          </div>

          <div className="panel miniPanel">
            <div className="panelHeader">
              <div className="left">
                <div style={{ fontWeight: 700 }}>Alerting</div>
                <span className="pill">Range: {rangeLabel}</span>
              </div>
            </div>
            <div className="panelBody">
              {alertChannels.length || filteredAlertIncidents.length ? (
                <div className="stackList">
                  <div>
                    <span className="stackLabel">Enabled channels</span>
                    <div className="stackValue">
                      {alertChannelStats.enabled} / {alertChannelStats.total}
                    </div>
                  </div>
                  <div>
                    <span className="stackLabel">Incidents in range</span>
                    <div className="stackValue">{alertIncidentStats.total}</div>
                  </div>
                  <div>
                    <span className="stackLabel">Critical / High</span>
                    <div className="stackValue">
                      {alertIncidentStats.critical + alertIncidentStats.high}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="panelPlaceholder">No alerting data yet.</div>
              )}
            </div>
          </div>

          <div className="panel miniPanel">
            <div className="panelHeader">
              <div className="left">
                <div style={{ fontWeight: 700 }}>Alert Incidents</div>
                <span className="pill">Range: {rangeLabel}</span>
              </div>
            </div>
            <div className="panelBody">
              {recentAlertIncidents.length ? (
                <table className="miniTable">
                  <thead>
                    <tr>
                      <th>When</th>
                      <th>Severity</th>
                      <th>Message</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentAlertIncidents.map((incident) => (
                      <tr
                        key={
                          incident._id ||
                          `${incident.type}-${incident.createdAt}`
                        }
                      >
                        <td className="mono">
                          {incident.createdAt
                            ? new Date(incident.createdAt).toLocaleString()
                            : "-"}
                        </td>
                        <td>
                          <span
                            className={[
                              "pill",
                              severityClass(incident.severity),
                            ].join(" ")}
                          >
                            {(incident.severity || "unknown").toUpperCase()}
                          </span>
                        </td>
                        <td>{incident.message || incident.type || "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div className="panelPlaceholder">No incidents in range.</div>
              )}
            </div>
          </div>

          <div className="panel miniPanel">
            <div className="panelHeader">
              <div className="left">
                <div style={{ fontWeight: 700 }}>🧠 Strategy Performance</div>
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
                        <td
                          className={[
                            "mono",
                            row.pnl >= 0 ? "goodText" : "badText",
                          ].join(" ")}
                        >
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
                <div style={{ fontWeight: 700 }}>🌐 Market Pulse</div>
                <span className="pill">Top symbols</span>
              </div>
            </div>
            <div className="panelBody">
              {instrumentPulse.length ? (
                <div className="pulseList">
                  {instrumentPulse.map((row) => (
                    <div key={row.token} className="pulseRow">
                      <div className="pulseSymbol">
                        {labelForToken(row.token, tokenLabels)}
                      </div>
                      <div className="pulseMeta">{row.count} trades</div>
                      <div
                        className={[
                          "pulseValue",
                          row.pnl >= 0 ? "goodText" : "badText",
                        ].join(" ")}
                      >
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
                <div style={{ fontWeight: 700 }}>🧰 Admin Actions</div>
                <span
                  className={[
                    "pill",
                    criticalOk === true
                      ? "good"
                      : criticalOk === false
                        ? "bad"
                        : "warn",
                  ].join(" ")}
                >
                  Critical Health{" "}
                  {criticalOk === null ? "N/A" : criticalOk ? "OK" : "FAIL"}
                </span>
              </div>
              <button
                className="btn small"
                type="button"
                onClick={() => criticalHealthQ.refetch()}
              >
                Refresh
              </button>
            </div>
            <div className="panelBody">
              <div className="healthList">
                {criticalChecks.length ? (
                  criticalChecks.map((check, idx) => (
                    <span
                      key={`${check.code}-${idx}`}
                      className={["pill", check.ok ? "good" : "bad"].join(" ")}
                    >
                      {check.code}
                    </span>
                  ))
                ) : (
                  <span className="muted">
                    No critical checks reported yet.
                  </span>
                )}
                {criticalFails.length ? (
                  <span className="muted">
                    Failures: {criticalFails.map((c) => c.code).join(", ")}
                  </span>
                ) : null}
              </div>
              <div className="actionGrid">
                <button
                  className="btn"
                  type="button"
                  onClick={handleHaltReset}
                  disabled={actionBusy.haltReset}
                  title="Clear runtime HALT flag"
                >
                  {actionBusy.haltReset ? "Resetting Halt…" : "Reset Halt"}
                </button>
                <button
                  className="btn"
                  type="button"
                  onClick={handleCalendarReload}
                  disabled={actionBusy.calendarReload}
                  title="Reload market calendar metadata"
                >
                  {actionBusy.calendarReload
                    ? "Reloading Calendar…"
                    : "Reload Calendar"}
                </button>
                <button
                  className="btn"
                  type="button"
                  onClick={handleRetentionEnsure}
                  disabled={actionBusy.retentionEnsure}
                  title="Ensure DB retention indexes"
                >
                  {actionBusy.retentionEnsure
                    ? "Ensuring Retention…"
                    : "Ensure Retention"}
                </button>
                <button
                  className="btn"
                  type="button"
                  onClick={handleCostCalibrationReload}
                  disabled={actionBusy.costCalibrationReload}
                  title="Reload cost calibration from DB"
                >
                  {actionBusy.costCalibrationReload
                    ? "Reloading Costs…"
                    : "Reload Costs"}
                </button>
                <button
                  className="btn"
                  type="button"
                  onClick={handleOptimizerReload}
                  disabled={actionBusy.optimizerReload}
                  title="Reload optimizer state"
                >
                  {actionBusy.optimizerReload
                    ? "Reloading Optimizer…"
                    : "Reload Optimizer"}
                </button>
                <button
                  className="btn"
                  type="button"
                  onClick={handleOptimizerFlush}
                  disabled={actionBusy.optimizerFlush}
                  title="Force optimizer persistence"
                >
                  {actionBusy.optimizerFlush
                    ? "Flushing Optimizer…"
                    : "Flush Optimizer"}
                </button>
                <button
                  className="btn"
                  type="button"
                  onClick={handleOptimizerReset}
                  disabled={actionBusy.optimizerReset}
                  title="Reset optimizer state"
                >
                  {actionBusy.optimizerReset
                    ? "Resetting Optimizer…"
                    : "Reset Optimizer"}
                </button>
                <button
                  className="btn"
                  type="button"
                  onClick={handleTelemetryFlush}
                  disabled={actionBusy.telemetryFlush}
                  title="Flush signal telemetry"
                >
                  {actionBusy.telemetryFlush
                    ? "Flushing Telemetry…"
                    : "Flush Telemetry"}
                </button>
                <button
                  className="btn"
                  type="button"
                  onClick={handleTradeTelemetryFlush}
                  disabled={actionBusy.tradeTelemetryFlush}
                  title="Flush trade telemetry"
                >
                  {actionBusy.tradeTelemetryFlush
                    ? "Flushing Trade Telemetry…"
                    : "Flush Trade Telemetry"}
                </button>
                <button
                  className="btn"
                  type="button"
                  onClick={handleAlertsTest}
                  disabled={actionBusy.alertsTest}
                  title="Send a test notification"
                >
                  {actionBusy.alertsTest ? "Sending Alert…" : "Send Test Alert"}
                </button>
              </div>
              <div className="actionNote">
                Actions require admin permissions (API key) and will log to
                audit trails on the backend.
              </div>
            </div>
          </div>

          <div className="panel miniPanel wide">
            <div className="panelHeader">
              <div className="left">
                <div style={{ fontWeight: 700 }}>Integration Health</div>
                <span className="pill">FE → BE checks</span>
              </div>
              <button
                className="btn small"
                type="button"
                onClick={refetchIntegration}
              >
                Refresh
              </button>
            </div>
            <div className="panelBody">
              <table className="miniTable integrationTable">
                <thead>
                  <tr>
                    <th>Area</th>
                    <th>Endpoint</th>
                    <th>Status</th>
                    <th>Records</th>
                    <th>Updated</th>
                    <th>Error</th>
                  </tr>
                </thead>
                <tbody>
                  {integrationChecks.map((check) => {
                    const query = check.query;
                    const count = check.count
                      ? check.count(query.data)
                      : query.data
                        ? 1
                        : 0;
                    const hasData =
                      count === null ? Boolean(query.data) : count > 0;
                    let statusLabel = "OK";
                    let tone = "good";
                    if (query.status === "error") {
                      statusLabel = "Error";
                      tone = "bad";
                    } else if (
                      query.status === "pending"
                    ) {
                      statusLabel = "Loading";
                      tone = "warn";
                    } else if (!hasData) {
                      statusLabel = "Empty";
                      tone = "warn";
                    } else if (query.isFetching) {
                      statusLabel = "Refreshing";
                      tone = "warn";
                    }
                    return (
                      <tr
                        key={check.id}
                        className="integrationRow"
                        onClick={() => setActiveIntegration(check)}
                      >
                        <td>{check.label}</td>
                        <td className="mono">{check.endpoint}</td>
                        <td>
                          <span className={["pill", tone].join(" ")}>
                            {statusLabel}
                          </span>
                        </td>
                        <td className="mono">
                          {count === null ? "-" : fmtCompact(count)}
                        </td>
                        <td className="mono">
                          {formatUpdatedAt(query.dataUpdatedAt)}
                        </td>
                        <td className="integrationError">
                          {query.status === "error"
                            ? formatQueryError(query.error)
                            : "-"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              {activeIntegration ? (
                <div
                  className="integrationModalBackdrop"
                  onClick={() => setActiveIntegration(null)}
                >
                  <div
                    className="integrationModal"
                    onClick={(event) => event.stopPropagation()}
                  >
                    <div className="panelHeader">
                      <div className="left">
                        <div style={{ fontWeight: 700 }}>{activeIntegration.label}</div>
                        <span className="pill mono">{activeIntegration.endpoint}</span>
                      </div>
                      <div className="actionsRow">
                        <button
                          className="btn small"
                          type="button"
                          onClick={() => void refreshIntegrationDetail()}
                          title="Refresh integration response"
                        >
                          {integrationDetail.loading ? "⟳" : "↻"}
                        </button>
                        <button
                          className="btn small"
                          type="button"
                          onClick={() => setActiveIntegration(null)}
                          title="Close dialog"
                        >
                          ✕
                        </button>
                      </div>
                    </div>

                    <div className="integrationModalBody">
                      {integrationDetail.error ? (
                        <div className="integrationModalError">{integrationDetail.error}</div>
                      ) : null}
                      <div className="integrationMetaRow">
                        <span className="pill">Updated: {formatUpdatedAt(integrationDetail.updatedAt)}</span>
                        <span className="pill">Data: {describeDataShape(integrationDetail.data)}</span>
                      </div>

                      {integrationDetail.data ? (
                        <>
                          {(() => {
                            const points = extractNumericSeries(integrationDetail.data);
                            if (!points.length) return null;
                            const max = Math.max(...points.map((p) => Math.abs(p.value)), 1);
                            return (
                              <div className="integrationChart">
                                {points.slice(0, 12).map((point) => (
                                  <div key={point.key} className="integrationChartRow">
                                    <div className="integrationChartLabel">{humanizePathLabel(point.key)}</div>
                                    <div className="integrationChartBarWrap">
                                      <div
                                        className="integrationChartBar"
                                        style={{ width: `${(Math.abs(point.value) / max) * 100}%` }}
                                      />
                                    </div>
                                    <div className="mono">{fmtCompact(point.value)}</div>
                                  </div>
                                ))}
                              </div>
                            );
                          })()}

                          {(() => {
                            const arrays = summarizeArrays(integrationDetail.data);
                            if (!arrays.length) return null;
                            return (
                              <div className="integrationArrays">
                                {arrays.map((row) => (
                                  <span key={row.key} className="pill">
                                    {humanizePathLabel(row.key)}: {row.size}
                                  </span>
                                ))}
                              </div>
                            );
                          })()}

                          <pre className="integrationJson">
                            {JSON.stringify(integrationDetail.data, null, 2)}
                          </pre>
                        </>
                      ) : (
                        <div className="muted">No response body yet.</div>
                      )}
                    </div>
                  </div>
                </div>
              ) : null}
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
                          {labelForToken(row.token, tokenLabels)} •{" "}
                          {row.side || "-"}
                        </div>
                        <div className="activityMeta">
                          {row.status || "status n/a"} •{" "}
                          {row.updatedAt
                            ? new Date(row.updatedAt).toLocaleString()
                            : "-"}
                        </div>
                      </div>
                      <div
                        className={[
                          "activityValue",
                          row.pnl !== null && row.pnl >= 0
                            ? "goodText"
                            : "badText",
                        ].join(" ")}
                      >
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

        <div className="truthDashboard">
          <div className="truthHeader">
            <div>
              <div className="overviewTitle">🔎 Truth Dashboard</div>
              <div className="overviewSubtitle">
                Per-trade diagnostics to explain edge vs cost vs execution.
              </div>
            </div>
            <span className="pill">Range: {rangeLabel}</span>
          </div>

          <div className="truthGrid">
            <div className="panel miniPanel wide truthSummary">
              <div className="panelHeader">
                <div className="left">
                  <div style={{ fontWeight: 700 }}>Truth Summary</div>
                  <span className="pill">All trades</span>
                </div>
              </div>
              <div className="panelBody">
                <div className="truthSummaryGrid">
                  <div>
                    <span className="stackLabel">Win rate</span>
                    <div className="stackValue">
                      {fmtPercent(truthSummary.winRate)}
                    </div>
                  </div>
                  <div>
                    <span className="stackLabel">Avg R</span>
                    <div className="stackValue">
                      {fmtNumber(truthSummary.avgR)}
                    </div>
                  </div>
                  <div>
                    <span className="stackLabel">Expectancy (E[R])</span>
                    <div className="stackValue">
                      {fmtNumber(truthSummary.expectancy)}
                    </div>
                  </div>
                  <div>
                    <span className="stackLabel">Avg slippage</span>
                    <div className="stackValue">
                      {fmtNumber(truthSummary.avgSlippage)}
                    </div>
                  </div>
                  <div>
                    <span className="stackLabel">Avg spread</span>
                    <div className="stackValue">
                      {fmtNumber(truthSummary.avgSpread)}
                    </div>
                  </div>
                  <div>
                    <span className="stackLabel">Avg MAE / MFE</span>
                    <div className="stackValue">
                      {fmtNumber(truthSummary.avgMae)} /{" "}
                      {fmtNumber(truthSummary.avgMfe)}
                    </div>
                  </div>
                  <div>
                    <span className="stackLabel">Avg hold time</span>
                    <div className="stackValue">
                      {truthSummary.avgHoldMin
                        ? `${truthSummary.avgHoldMin.toFixed(1)}m`
                        : "-"}
                    </div>
                  </div>
                  <div>
                    <span className="stackLabel">Loss driver</span>
                    <div className="stackValue">{truthCostInsight.verdict}</div>
                  </div>
                </div>

                <div className="truthSubGrid">
                  <div>
                    <div className="truthSubTitle">Time-in-trade</div>
                    <div className="truthChips">
                      {truthHoldDistribution.map((bucket) => (
                        <span key={bucket.label} className="pill">
                          {bucket.label} {bucket.count} (
                          {fmtNumber(bucket.pct, 0)}%)
                        </span>
                      ))}
                    </div>
                  </div>
                  <div>
                    <div className="truthSubTitle">Daily report</div>
                    <div className="truthReport">
                      {truthReportLines.length ? (
                        truthReportLines.map((line) => (
                          <div key={line} className="truthReportLine">
                            {line}
                          </div>
                        ))
                      ) : (
                        <div className="panelPlaceholder">
                          Not enough trades to summarize yet.
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="panel miniPanel wide">
              <div className="panelHeader">
                <div className="left">
                  <div style={{ fontWeight: 700 }}>
                    Strategy × Regime Breakdown
                  </div>
                  <span className="pill">Top + Bottom</span>
                </div>
              </div>
              <div className="panelBody">
                {truthByStrategyRegime.length ? (
                  <table className="miniTable truthTable">
                    <thead>
                      <tr>
                        <th>Combo</th>
                        <th>Trades</th>
                        <th>Win %</th>
                        <th>Avg R</th>
                        <th>E[R]</th>
                        <th>Slip</th>
                        <th>Spread</th>
                      </tr>
                    </thead>
                    <tbody>
                      {truthByStrategyRegime.slice(0, 6).map((row) => (
                        <tr key={row.key}>
                          <td className="mono">{row.key}</td>
                          <td className="mono">{row.count}</td>
                          <td className="mono">{fmtPercent(row.winRate)}</td>
                          <td className="mono">{fmtNumber(row.avgR)}</td>
                          <td className="mono">{fmtNumber(row.expectancy)}</td>
                          <td className="mono">{fmtNumber(row.avgSlippage)}</td>
                          <td className="mono">{fmtNumber(row.avgSpread)}</td>
                        </tr>
                      ))}
                      {truthByStrategyRegime.length > 6
                        ? truthByStrategyRegime
                            .slice(-2)
                            .map((row) => (
                              <tr key={row.key} className="mutedRow">
                                <td className="mono">{row.key}</td>
                                <td className="mono">{row.count}</td>
                                <td className="mono">
                                  {fmtPercent(row.winRate)}
                                </td>
                                <td className="mono">{fmtNumber(row.avgR)}</td>
                                <td className="mono">
                                  {fmtNumber(row.expectancy)}
                                </td>
                                <td className="mono">
                                  {fmtNumber(row.avgSlippage)}
                                </td>
                                <td className="mono">
                                  {fmtNumber(row.avgSpread)}
                                </td>
                              </tr>
                            ))
                        : null}
                    </tbody>
                  </table>
                ) : (
                  <div className="panelPlaceholder">
                    No strategy/regime stats yet.
                  </div>
                )}
              </div>
            </div>

            <div className="panel miniPanel">
              <div className="panelHeader">
                <div className="left">
                  <div style={{ fontWeight: 700 }}>Regime Stats</div>
                  <span className="pill">OPEN/TREND/RANGE</span>
                </div>
              </div>
              <div className="panelBody">
                {truthByRegime.length ? (
                  <table className="miniTable truthTable">
                    <thead>
                      <tr>
                        <th>Regime</th>
                        <th>Trades</th>
                        <th>Win %</th>
                        <th>E[R]</th>
                      </tr>
                    </thead>
                    <tbody>
                      {truthByRegime.map((row) => (
                        <tr key={row.key}>
                          <td className="mono">{row.key}</td>
                          <td className="mono">{row.count}</td>
                          <td className="mono">{fmtPercent(row.winRate)}</td>
                          <td className="mono">{fmtNumber(row.expectancy)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <div className="panelPlaceholder">No regime stats yet.</div>
                )}
              </div>
            </div>

            <div className="panel miniPanel">
              <div className="panelHeader">
                <div className="left">
                  <div style={{ fontWeight: 700 }}>Time Bucket</div>
                  <span className="pill">9:15–15:30</span>
                </div>
              </div>
              <div className="panelBody">
                {truthByTimeBucket.length ? (
                  <table className="miniTable truthTable">
                    <thead>
                      <tr>
                        <th>Bucket</th>
                        <th>Trades</th>
                        <th>E[R]</th>
                      </tr>
                    </thead>
                    <tbody>
                      {truthByTimeBucket.map((row) => (
                        <tr key={row.key}>
                          <td className="mono">{row.key}</td>
                          <td className="mono">{row.count}</td>
                          <td className="mono">{fmtNumber(row.expectancy)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <div className="panelPlaceholder">No time stats yet.</div>
                )}
              </div>
            </div>

            <div className="panel miniPanel">
              <div className="panelHeader">
                <div className="left">
                  <div style={{ fontWeight: 700 }}>Premium Bands</div>
                  <span className="pill">Entry premium</span>
                </div>
              </div>
              <div className="panelBody">
                {truthByPremiumBand.length ? (
                  <table className="miniTable truthTable">
                    <thead>
                      <tr>
                        <th>Band</th>
                        <th>Trades</th>
                        <th>E[R]</th>
                        <th>Slip</th>
                      </tr>
                    </thead>
                    <tbody>
                      {truthByPremiumBand.map((row) => (
                        <tr key={row.key}>
                          <td className="mono">{row.key}</td>
                          <td className="mono">{row.count}</td>
                          <td className="mono">{fmtNumber(row.expectancy)}</td>
                          <td className="mono">
                            {fmtNumber(row.avgSlippage)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <div className="panelPlaceholder">
                    No premium stats yet.
                  </div>
                )}
              </div>
            </div>

            <div className="panel miniPanel">
              <div className="panelHeader">
                <div className="left">
                  <div style={{ fontWeight: 700 }}>Strategy Stats</div>
                  <span className="pill">Edge snapshot</span>
                </div>
              </div>
              <div className="panelBody">
                {truthByStrategy.length ? (
                  <table className="miniTable truthTable">
                    <thead>
                      <tr>
                        <th>Strategy</th>
                        <th>Trades</th>
                        <th>Win %</th>
                        <th>E[R]</th>
                      </tr>
                    </thead>
                    <tbody>
                      {truthByStrategy.map((row) => (
                        <tr key={row.key}>
                          <td className="mono">{row.key}</td>
                          <td className="mono">{row.count}</td>
                          <td className="mono">{fmtPercent(row.winRate)}</td>
                          <td className="mono">{fmtNumber(row.expectancy)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <div className="panelPlaceholder">
                    No strategy stats yet.
                  </div>
                )}
              </div>
            </div>

            <div className="panel miniPanel wide">
              <div className="panelHeader">
                <div className="left">
                  <div style={{ fontWeight: 700 }}>
                    Per-Trade Diagnostics
                  </div>
                  <span className="pill">Latest 8</span>
                </div>
              </div>
              <div className="panelBody">
                {truthPerTrade.length ? (
                  <table className="miniTable truthTable">
                    <thead>
                      <tr>
                        <th>Trade</th>
                        <th>Strategy</th>
                        <th>Regime</th>
                        <th>R</th>
                        <th>Slip</th>
                        <th>Spread</th>
                        <th>MAE</th>
                        <th>MFE</th>
                        <th>Hold</th>
                      </tr>
                    </thead>
                    <tbody>
                      {truthPerTrade.map((row) => (
                        <tr key={row.id}>
                          <td className="mono">{row.id}</td>
                          <td className="mono">{row.strategy}</td>
                          <td className="mono">{row.regime}</td>
                          <td className="mono">{fmtNumber(row.r)}</td>
                          <td className="mono">{fmtNumber(row.slippage)}</td>
                          <td className="mono">{fmtNumber(row.spread)}</td>
                          <td className="mono">{fmtNumber(row.mae)}</td>
                          <td className="mono">{fmtNumber(row.mfe)}</td>
                          <td className="mono">
                            {row.holdMin ? `${row.holdMin.toFixed(1)}m` : "-"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <div className="panelPlaceholder">
                    No trade diagnostics yet.
                  </div>
                )}
              </div>
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
              currentMs={currentMs}
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
        <div
          className={["blotterShell", blotterOpen ? "open" : "closed"].join(
            " ",
          )}
        >
          <TradeBlotter
            trades={filteredTrades}
            limit={blotterLimit}
            onLimitChange={setBlotterLimit}
            tokenLabels={tokenLabels}
            selectedToken={selectedToken}
            onSelectToken={(tok) => focusToken(tok)}
            onClose={() => setBlotterOpen(false)}
            rangeLabel={`Range: ${rangeLabel}`}
          />
        </div>

        {!blotterOpen ? (
          <button
            className="blotterHandle"
            type="button"
            onClick={() => setBlotterOpen(true)}
            title="Open trade blotter"
          >
            Blotter
          </button>
        ) : null}

        {/* Toasts */}
        <div className="toastHost" aria-live="polite">
          {toasts.map((t) => (
            <div key={t.id} className={["toast", t.level].join(" ")}>
              <div className="toastMsg">{t.message}</div>
              <button
                className="toastClose"
                onClick={() =>
                  setToasts((prev) => prev.filter((x) => x.id !== t.id))
                }
                title="Dismiss"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
