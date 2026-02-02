import { TickMarkType } from 'lightweight-charts';
import type { Time } from 'lightweight-charts';
import type { CandleRow, TradeRow } from '../types/backend';

const IST_TIME_ZONE = 'Asia/Kolkata';

function toIstDate(time: Time): Date {
  // `Time` from lightweight-charts can be:
  // - number (unix seconds)
  // - string (e.g., '2026-02-02')
  // - BusinessDay object ({ year, month, day })
  if (typeof time === 'number') {
    return new Date(time * 1000);
  }

  if (typeof time === 'string') {
    const d = new Date(time);
    if (!Number.isNaN(d.getTime())) return d;

    const n = Number(time);
    if (Number.isFinite(n)) return new Date(n * 1000);

    return new Date();
  }

  if (time && typeof time === 'object' && 'year' in time) {
    const bd = time as any;
    return new Date(Date.UTC(bd.year, bd.month - 1, bd.day));
  }

  return new Date();
}

function formatIstWithOptions(date: Date, options: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: IST_TIME_ZONE,
    ...options,
  }).format(date);
}

export function formatIstTick(time: Time, tickMarkType: TickMarkType): string {
  const date = toIstDate(time);
  switch (tickMarkType) {
    case TickMarkType.Year:
      return formatIstWithOptions(date, { year: 'numeric' });
    case TickMarkType.Month:
      return formatIstWithOptions(date, { month: 'short' });
    case TickMarkType.DayOfMonth:
      return formatIstWithOptions(date, { day: '2-digit', month: 'short' });
    case TickMarkType.Time:
      return formatIstWithOptions(date, {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      });
    case TickMarkType.TimeWithSeconds:
      return formatIstWithOptions(date, {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      });
    default:
      return formatIstWithOptions(date, {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      });
  }
}

export function formatIstDateTime(time: Time, withSeconds = false): string {
  const date = toIstDate(time);
  return formatIstWithOptions(date, {
    year: '2-digit',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: withSeconds ? '2-digit' : undefined,
    hour12: false,
  });
}

export type LwCandle = { time: number; open: number; high: number; low: number; close: number };
export type LwVolume = { time: number; value: number };

export function toLwCandles(rows: CandleRow[]): LwCandle[] {
  return (rows || [])
    .map((c) => ({
      time: Math.floor(new Date(c.ts).getTime() / 1000),
      open: Number(c.open),
      high: Number(c.high),
      low: Number(c.low),
      close: Number(c.close),
    }))
    .filter((x) => Number.isFinite(x.time) && Number.isFinite(x.open) && Number.isFinite(x.high) && Number.isFinite(x.low) && Number.isFinite(x.close));
}

export function toLwVolume(rows: CandleRow[]): LwVolume[] {
  return (rows || [])
    .map((c) => ({ time: Math.floor(new Date(c.ts).getTime() / 1000), value: Number(c.volume || 0) }))
    .filter((x) => Number.isFinite(x.time) && Number.isFinite(x.value));
}

export function nearestCandleTime(candles: LwCandle[], tsMs: number): number | null {
  if (!candles.length || !Number.isFinite(tsMs)) return null;
  const target = Math.floor(tsMs / 1000);
  // binary search by time
  let lo = 0;
  let hi = candles.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const t = candles[mid].time;
    if (t === target) return t;
    if (t < target) lo = mid + 1;
    else hi = mid - 1;
  }
  // lo is insertion point
  const left = Math.max(0, Math.min(candles.length - 1, lo - 1));
  const right = Math.max(0, Math.min(candles.length - 1, lo));
  const dl = Math.abs(candles[left].time - target);
  const dr = Math.abs(candles[right].time - target);
  return dl <= dr ? candles[left].time : candles[right].time;
}

export function buildTradeMarkers(opts: {
  token: number;
  trades: TradeRow[];
  candles: LwCandle[];
  max?: number;
}) {
  const { token, trades, candles, max = 20 } = opts;
  const rows = (trades || [])
    .filter((t) => Number(t.instrument_token) === Number(token))
    .sort((a, b) => (new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime()))
    .slice(-max);

  const markers: any[] = [];

  for (const t of rows) {
    const createdMs = new Date(t.createdAt || t.updatedAt || Date.now()).getTime();
    const time = nearestCandleTime(candles, createdMs);
    if (!time) continue;

    const side = (t.side || '').toUpperCase();
    const sym = t.instrument?.tradingsymbol ? String(t.instrument.tradingsymbol) : String(t.instrument_token);
    const strat = t.strategyId ? String(t.strategyId) : '';

    if (side === 'BUY') {
      markers.push({
        time,
        position: 'belowBar',
        shape: 'arrowUp',
        color: '#2ee59d',
        text: `BUY ${sym}${strat ? ` (${strat})` : ''}`,
      });
    } else if (side === 'SELL') {
      markers.push({
        time,
        position: 'aboveBar',
        shape: 'arrowDown',
        color: '#ff6b6b',
        text: `SELL ${sym}${strat ? ` (${strat})` : ''}`,
      });
    } else {
      markers.push({
        time,
        position: 'aboveBar',
        shape: 'circle',
        color: '#ffcc66',
        text: `TRADE ${sym}`,
      });
    }
  }

  return markers;
}

export function getLatestTradeForToken(trades: TradeRow[], token: number): TradeRow | null {
  const rows = (trades || []).filter((t) => Number(t.instrument_token) === Number(token));
  if (!rows.length) return null;
  rows.sort((a, b) => new Date(b.createdAt || b.updatedAt || 0).getTime() - new Date(a.createdAt || a.updatedAt || 0).getTime());
  return rows[0] || null;
}
