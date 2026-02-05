import type { TradeRow } from "../types/backend";

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

const MONTHS_SHORT: Record<string, string> = {
  JAN: "Jan",
  FEB: "Feb",
  MAR: "Mar",
  APR: "Apr",
  MAY: "May",
  JUN: "Jun",
  JUL: "Jul",
  AUG: "Aug",
  SEP: "Sep",
  OCT: "Oct",
  NOV: "Nov",
  DEC: "Dec",
};

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function optionWord(t?: string | null) {
  const s = String(t || "").toUpperCase();
  if (s === "PE" || s === "PUT") return "Put";
  if (s === "CE" || s === "CALL") return "Call";
  // Sometimes instrument_type can be 'OPT' or similar; fall back.
  if (s.includes("PE")) return "Put";
  if (s.includes("CE")) return "Call";
  return "";
}

function tryFormatExpiry(iso?: string | null) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const day = pad2(d.getDate());
  const mon = MONTHS[d.getMonth()] || "";
  return `${day} ${mon}`;
}

export type ParsedTradingSymbol = {
  underlying: string;
  day?: string;
  mon?: string;
  year?: string;
  strike?: string;
  optType?: "CE" | "PE";
};

/**
 * Parses common NSE option tradingsymbols like:
 *   NIFTY2620324800PE
 *   BANKNIFTY2620520000CE
 *
 * Pattern (typical weekly): UNDERLYING + YY + M(M) + DD + STRIKE + CE/PE
 */
export function parseTradingSymbol(tradingsymbol?: string | null): ParsedTradingSymbol | null {
  if (!tradingsymbol) return null;
  const ts = String(tradingsymbol).trim().toUpperCase();

  // Common format: UNDERLYING + YY + M{1,2} + DD + STRIKE + CE|PE
  const m = ts.match(/^([A-Z]+?)(\d{2})(\d{1,2})(\d{2})(\d+)(CE|PE)$/);
  if (m) {
    const underlying = m[1];
    const year = m[2];
    const monNum = Number(m[3]);
    const day = pad2(Number(m[4]));
    const strike = m[5];
    const optType = m[6] as "CE" | "PE";
    const mon = MONTHS[monNum - 1] || "";
    return { underlying, year, mon, day, strike, optType };
  }

  // Monthly format: UNDERLYING + YY + MMM + STRIKE + CE|PE
  const mMonthOnly = ts.match(/^([A-Z]+?)(\d{2})([A-Z]{3})(\d+)(CE|PE)$/);
  if (mMonthOnly) {
    const underlying = mMonthOnly[1];
    const year = mMonthOnly[2];
    const mon = MONTHS_SHORT[mMonthOnly[3]] || "";
    const strike = mMonthOnly[4];
    const optType = mMonthOnly[5] as "CE" | "PE";
    return { underlying, year, mon, strike, optType };
  }

  // Weekly format with month letters: UNDERLYING + YY + MMM + DD + STRIKE + CE|PE
  const mMonthDay = ts.match(/^([A-Z]+?)(\d{2})([A-Z]{3})(\d{2})(\d+)(CE|PE)$/);
  if (mMonthDay) {
    const underlying = mMonthDay[1];
    const year = mMonthDay[2];
    const mon = MONTHS_SHORT[mMonthDay[3]] || "";
    const day = pad2(Number(mMonthDay[4]));
    const strike = mMonthDay[5];
    const optType = mMonthDay[6] as "CE" | "PE";
    return { underlying, year, mon, day, strike, optType };
  }

  // Fallback: try to pick out the underlying and CE/PE at the end.
  const m2 = ts.match(/^([A-Z]+)(\d+)(CE|PE)$/);
  if (m2) {
    return { underlying: m2[1], strike: m2[2], optType: m2[3] as any };
  }

  return null;
}

export function formatPrettyInstrumentFromTradingSymbol(tradingsymbol?: string | null) {
  const p = parseTradingSymbol(tradingsymbol);
  if (!p) return null;
  const expiry = p.day && p.mon ? `${p.day} ${p.mon}` : null;
  const opt = optionWord(p.optType);
  if (expiry && p.strike && opt) return `${p.underlying} ${expiry} ${p.strike} ${opt}`;
  if (p.strike && opt) return `${p.underlying} ${p.strike} ${opt}`;
  return `${p.underlying}`;
}

/**
 * Best-effort, human friendly label like: "NIFTY 03 Feb 24800 Put".
 * Prefers backend instrument fields when present; falls back to tradingsymbol parsing.
 */
export function formatPrettyInstrumentFromTrade(trade: TradeRow): string {
  const tok = Number((trade as any)?.instrument_token);
  const inst: any = (trade as any)?.instrument || {};
  const topLevel = trade as any;
  const ts =
    inst?.tradingsymbol ||
    topLevel?.tradingsymbol ||
    topLevel?.tradingSymbol ||
    topLevel?.symbol;
  const parsed = parseTradingSymbol(ts) || null;

  const underlying =
    parsed?.underlying || (ts ? String(ts).replace(/\d.*$/, "") : "") || "";
  const expiry =
    tryFormatExpiry(inst?.expiry || topLevel?.expiry) ||
    (parsed?.day && parsed?.mon ? `${parsed.day} ${parsed.mon}` : null);
  const strike =
    inst?.strike !== undefined && inst?.strike !== null
      ? String(inst.strike)
      : topLevel?.strike !== undefined && topLevel?.strike !== null
        ? String(topLevel.strike)
        : parsed?.strike;
  const opt = optionWord(
    inst?.instrument_type || topLevel?.instrument_type || parsed?.optType,
  );

  const parts: string[] = [];
  if (underlying) parts.push(underlying);
  if (expiry) parts.push(expiry);
  if (strike) parts.push(strike);
  if (opt) parts.push(opt);

  const out = parts.join(" ").trim();
  return out || (Number.isFinite(tok) ? String(tok) : "-");
}

export function formatPrettyTokenLabel(token: number, tokenLabels: Record<number, string>) {
  const base = tokenLabels?.[token];
  return base ? `${base} (${token})` : String(token);
}
