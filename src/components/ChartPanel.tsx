import React from 'react';
import { CandleChart } from './CandleChart';
import { useCandles } from '../lib/hooks';
import type { CandleRow, TradeRow } from '../types/backend';

export type ChartConfig = {
  token: number | null;
  intervalMin: number;
};

type Props = {
  index: number;
  config: ChartConfig;
  tokens: number[];
  tokenLabels: Record<number, string>;
  trades: TradeRow[];
  tradesLoading: boolean;
  socketConnected: boolean;
  serverNowMs: number;
  onChange: (next: ChartConfig) => void;
};

function labelForToken(token: number, tokenLabels: Record<number, string>) {
  const sym = tokenLabels?.[token];
  return sym ? `${sym} (${token})` : String(token);
}

function formatLagSeconds(sec: number) {
  if (!Number.isFinite(sec) || sec < 0) return '-';
  if (sec < 10) return `${sec.toFixed(1)}s`;
  if (sec < 60) return `${Math.round(sec)}s`;
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}m ${s}s`;
}

export function ChartPanel({
  index,
  config,
  tokens,
  tokenLabels,
  trades,
  tradesLoading,
  socketConnected,
  serverNowMs,
  onChange,
}: Props) {
  const [isFullscreen, setIsFullscreen] = React.useState(false);
  const token = config.token;
  const intervalMin = config.intervalMin;

  React.useEffect(() => {
    if (!isFullscreen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsFullscreen(false);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isFullscreen]);

  React.useEffect(() => {
    if (!isFullscreen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [isFullscreen]);

  const candlesQ = useCandles(token, intervalMin, 320, socketConnected ? false : 2500);
  const rows: CandleRow[] = candlesQ.data?.rows || [];

  const display = token !== null ? labelForToken(token, tokenLabels) : '-';
  const title = `Chart ${index + 1} • ${display} • ${intervalMin}m`;

  const errorMsg =
    (candlesQ.error as any)?.response?.data?.error ||
    (candlesQ.error as any)?.message ||
    null;

  const lastTs = rows.length ? rows[rows.length - 1]?.ts : null;
  const lastMs = lastTs ? new Date(lastTs).getTime() : NaN;
  const lagSec = Number.isFinite(lastMs) ? Math.max(0, (serverNowMs - lastMs) / 1000) : NaN;

  // Treat "stale" as > 2 intervals without updates (handles both partial-bar and completed-bar feeds).
  const goodCut = intervalMin * 60 + 8;
  const warnCut = intervalMin * 60 * 2 + 15;
  const lagClass = !Number.isFinite(lagSec) ? '' : lagSec <= goodCut ? 'good' : lagSec <= warnCut ? 'warn' : 'bad';

  return (
    <div className={['panel', isFullscreen ? 'panelFullscreen' : ''].join(' ')}>
      <div className="panelHeader">
        <div className="left">
          <div className="field">
            <label>Token</label>
            <select
              className="small"
              value={token ?? ''}
              onChange={(e) =>
                onChange({
                  ...config,
                  token: e.target.value ? Number(e.target.value) : null,
                })
              }
            >
              <option value="">Select token</option>
              {(tokens || []).map((t) => (
                <option key={t} value={t}>
                  {labelForToken(t, tokenLabels)}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label>Interval</label>
            <select
              className="small"
              value={intervalMin}
              onChange={(e) =>
                onChange({ ...config, intervalMin: Number(e.target.value) })
              }
            >
              <option value={1}>1m</option>
              <option value={3}>3m</option>
              <option value={5}>5m</option>
            </select>
          </div>

          <div className="smallText">
            {candlesQ.isFetching
              ? 'updating…'
              : candlesQ.data
                ? `candles: ${rows.length}`
                : 'no data'}
          </div>

          {token !== null && rows.length ? (
            <span
              className={['pill', lagClass].join(' ')}
              title={lastTs ? `Last candle ts: ${lastTs}` : 'Last candle ts: n/a'}
            >
              lag: {formatLagSeconds(lagSec)}
            </span>
          ) : null}
        </div>

        <div className="panelHeaderActions">
          <div className="smallText">
            {tradesLoading
              ? 'trades…'
              : trades.length
                ? `trades: ${trades.length}`
                : ''}
          </div>
          <button
            className="btn small"
            type="button"
            onClick={() => setIsFullscreen((prev) => !prev)}
          >
            {isFullscreen ? 'Close' : 'Full screen'}
          </button>
        </div>
      </div>

      <div className="chartWrap">
        {token !== null && rows.length ? (
          <CandleChart
            key={`${token}-${intervalMin}`}
            token={token}
            title={title}
            candles={rows}
            trades={trades}
            intervalMin={intervalMin}
          />
        ) : (
          <div className="panelPlaceholder">
            {token !== null
              ? 'Waiting for candles… (need /admin/candles/recent)'
              : 'Select a token to load candles'}
          </div>
        )}
      </div>

      {errorMsg ? <div className="errorBox">{String(errorMsg)}</div> : null}
    </div>
  );
}
