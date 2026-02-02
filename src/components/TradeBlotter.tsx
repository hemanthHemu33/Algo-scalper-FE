import React from 'react';
import type { TradeRow } from '../types/backend';

type Limit = 20 | 50;

type Props = {
  trades: TradeRow[];
  limit: Limit;
  onLimitChange: (next: Limit) => void;
  tokenLabels: Record<number, string>;
};

const IST_TZ = 'Asia/Kolkata';

function fmtNumber(n: number | null | undefined, digits = 2) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '-';
  return v.toFixed(digits);
}

function fmtInt(n: number | null | undefined) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '-';
  return String(Math.round(v));
}

function fmtIst(ts?: string) {
  if (!ts) return '-';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '-';
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: IST_TZ,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    day: '2-digit',
    month: 'short',
  }).format(d);
}

function symbolFor(trade: TradeRow, tokenLabels: Record<number, string>) {
  const tok = Number(trade.instrument_token);
  const sym = trade.instrument?.tradingsymbol || tokenLabels?.[tok];
  return sym ? String(sym) : String(tok);
}

function calcPnl(trade: TradeRow) {
  const side = (trade.side || '').toUpperCase();
  const qty = Number(trade.qty);
  const entry = Number(trade.entryPrice);
  const exit = Number(trade.exitPrice);

  if (!Number.isFinite(qty) || !Number.isFinite(entry) || !Number.isFinite(exit))
    return null;

  const raw =
    side === 'SELL' ? (entry - exit) * qty : side === 'BUY' ? (exit - entry) * qty : null;

  if (!Number.isFinite(Number(raw))) return null;
  return Number(raw);
}

function statusClass(status?: string) {
  const s = (status || '').toUpperCase();
  if (!s) return '';
  if (s.includes('OPEN') || s.includes('ACTIVE')) return 'warn';
  if (s.includes('CLOSED') || s.includes('DONE') || s.includes('EXIT')) return 'good';
  if (s.includes('REJECT') || s.includes('CANCEL') || s.includes('FAIL')) return 'bad';
  return '';
}

export function TradeBlotter({ trades, limit, onLimitChange, tokenLabels }: Props) {
  const rows = React.useMemo(() => (trades || []).slice(0, limit), [trades, limit]);

  return (
    <div className="panel blotter">
      <div className="panelHeader blotterHeader">
        <div className="left">
          <div style={{ fontWeight: 700 }}>Trade Blotter</div>
          <span className="pill">last {limit}</span>
        </div>

        <div className="panelHeaderActions">
          <div className="field">
            <label>Show</label>
            <select
              className="small"
              value={limit}
              onChange={(e) => onLimitChange(Number(e.target.value) as Limit)}
            >
              <option value={20}>20</option>
              <option value={50}>50</option>
            </select>
          </div>
        </div>
      </div>

      <div className="blotterBody">
        {rows.length ? (
          <table className="blotterTable">
            <thead>
              <tr>
                <th>Time</th>
                <th>Symbol</th>
                <th>Side</th>
                <th>Qty</th>
                <th>Entry</th>
                <th>Exit</th>
                <th>Status</th>
                <th>P&amp;L</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => {
                const sym = symbolFor(t, tokenLabels);
                const pnl = calcPnl(t);
                const st = t.status || '-';
                const stClass = statusClass(t.status);
                const when = t.updatedAt || t.createdAt;

                return (
                  <tr
                    key={t.tradeId}
                    title={[
                      `tradeId: ${t.tradeId}`,
                      t.strategyId ? `strategy: ${t.strategyId}` : '',
                      t.closeReason ? `close: ${t.closeReason}` : '',
                      Number.isFinite(Number(t.stopLoss)) ? `SL: ${t.stopLoss}` : '',
                      Number.isFinite(Number(t.targetPrice)) ? `TGT: ${t.targetPrice}` : '',
                    ]
                      .filter(Boolean)
                      .join('\n')}
                  >
                    <td className="mono">{fmtIst(when)}</td>
                    <td className="mono">{sym}</td>
                    <td className={['mono', (t.side || '').toUpperCase() === 'BUY' ? 'goodText' : (t.side || '').toUpperCase() === 'SELL' ? 'badText' : ''].join(' ')}>
                      {t.side || '-'}
                    </td>
                    <td className="mono">{fmtInt(t.qty)}</td>
                    <td className="mono">{fmtNumber(t.entryPrice)}</td>
                    <td className="mono">{fmtNumber(t.exitPrice)}</td>
                    <td>
                      <span className={['pill', stClass].join(' ')}>{st}</span>
                    </td>
                    <td className="mono">
                      {pnl === null ? '-' : pnl >= 0 ? `+${pnl.toFixed(2)}` : pnl.toFixed(2)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <div className="panelPlaceholder">No trades yet. Waiting for /admin/trades/recent…</div>
        )}
      </div>
    </div>
  );
}
