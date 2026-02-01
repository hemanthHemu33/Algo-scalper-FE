import { TickMarkType } from 'lightweight-charts';
import type { BusinessDay, Time } from 'lightweight-charts';
import type { CandleRow, TradeRow } from '../types/backend';

const IST_TIME_ZONE = 'Asia/Kolkata';

function isBusinessDay(time: Time): time is BusinessDay {
  return typeof time === 'object' && time !== null && 'year' in time;
}

function isYYYYMMDD(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

function toIstDate(time: Time): Date {
  if (typeof time === 'number') {
    return new Date(time * 1000);
  }

  if (typeof time === 'string') {
    // lightweight-charts uses YYYY-MM-DD strings for business days.
    if (isYYYYMMDD(time)) {
      const [y, m, d] = time.split('-').map((x) => Number(x));
      return new Date(Date.UTC(y, m - 1, d));
    }
    // Fallback: try Date parsing.
    const dt = new Date(time);
    return Number.isFinite(dt.getTime()) ? dt : new Date(0);
  }

  if (isBusinessDay(time)) {
    return new Date(Date.UTC(time.year, time.month - 1, time.day));
  }

  return new Date(0);
}

// Intl.DateTimeFormat construction is relatively expensive. Keep a small cache.
const fmt = {
  year: new Intl.DateTimeFormat('en-IN', { timeZone: IST_TIME_ZONE, year: 'numeric' }),
  month: new Intl.DateTimeFormat('en-IN', { timeZone: IST_TIME_ZONE, month: 'short' }),
  dayMonth: new Intl.DateTimeFormat('en-IN', { timeZone: IST_TIME_ZONE, day: '2-digit', month: 'short' }),
  hm: new Intl.DateTimeFormat('en-IN', { timeZone: IST_TIME_ZONE, hour: '2-digit', minute: '2-digit', hour12: false }),
  hms: new Intl.DateTimeFormat('en-IN', { timeZone: IST_TIME_ZONE, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }),
  dateTime: new Intl.DateTimeFormat('en-IN', { timeZone: IST_TIME_ZONE, year: '2-digit', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }),
  dateTimeSec: new Intl.DateTimeFormat('en-IN', { timeZone: IST_TIME_ZONE, year: '2-digit', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }),
};

export function formatIstTick(time: Time, tickMarkType: TickMarkType): string {
  const date = toIstDate(time);
  switch (tickMarkType) {
    case TickMarkType.Year:
      return fmt.year.format(date);
    case TickMarkType.Month:
      return fmt.month.format(date);
    case TickMarkType.DayOfMonth:
      return fmt.dayMonth.format(date);
    case TickMarkType.Time:
      return fmt.hm.format(date);
    case TickMarkType.TimeWithSeconds:
      return fmt.hms.format(date);
    default:
      return fmt.hm.format(date);
  }
}

export function formatIstDateTime(time: Time, withSeconds = false): string {
  const date = toIstDate(time);
  return withSeconds ? fmt.dateTimeSec.format(date) : fmt.dateTime.format(date);
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
