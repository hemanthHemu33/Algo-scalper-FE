import React from 'react';
import { CandleChart } from './CandleChart';
import { useCandles, useLiveLtp } from '../lib/hooks';
import type { CandleRow, TradeRow } from '../types/backend';
import { getIstDayStartMs, getLatestOpenTradeForToken } from '../lib/chartUtils';

export type ChartConfig = {
  token: number | null;
  intervalMin: number;
};

export type FeedHealth = {
  index: number;
  token: number | null;
  intervalMin: number;
  lastTs: string | null;
  lagSec: number | null;
  stale: boolean;
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
  currentMs: number;
  isFocused?: boolean;
  onFeedHealth?: (h: FeedHealth) => void;
  panelId?: string;
  onChange: (next: ChartConfig) => void;
};

function labelForToken(token: number, tokenLabels: Record<number, string>) {
  const pretty = tokenLabels?.[token];
  return pretty ? String(pretty) : String(token);
}

function formatLagSeconds(sec: number) {
  if (!Number.isFinite(sec) || sec < 0) return '-';
  if (sec < 10) return `${sec.toFixed(1)}s`;
  if (sec < 60) return `${Math.round(sec)}s`;
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}m ${s}s`;
}

function computeBreachState(trade: TradeRow | null, ltp: number): 'NORMAL' | 'SL' | 'TGT' {
  if (!trade || !Number.isFinite(ltp)) return 'NORMAL';
  const side = (trade.side || '').toUpperCase();
  const sl = Number(trade.stopLoss);
  const tgt = Number(trade.targetPrice);

  if (side === 'BUY') {
    if (Number.isFinite(sl) && ltp <= sl) return 'SL';
    if (Number.isFinite(tgt) && ltp >= tgt) return 'TGT';
  } else if (side === 'SELL') {
    if (Number.isFinite(sl) && ltp >= sl) return 'SL';
    if (Number.isFinite(tgt) && ltp <= tgt) return 'TGT';
  }
  return 'NORMAL';
}

function pickLiveLtp(value: any): number {
  const candidates = [
    value?.ltp,
    value?.lastPrice,
    value?.price,
  ];
  for (const c of candidates) {
    const num = Number(c);
    if (Number.isFinite(num)) return num;
  }
  return NaN;
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
  currentMs,
  isFocused,
  onFeedHealth,
  panelId,
  onChange,
}: Props) {
  const [isFullscreen, setIsFullscreen] = React.useState(false);
  const [overlayN, setOverlayN] = React.useState<number>(0);

  const [pollMs, setPollMs] = React.useState<number | false>(
    socketConnected ? false : 2500,
  );

  const token = config.token;
  const intervalMin = config.intervalMin;

  // Reset polling baseline when the feed mode or chart identity changes.
  React.useEffect(() => {
    setPollMs(socketConnected ? false : 2500);
  }, [socketConnected, token, intervalMin]);

  React.useEffect(() => {
    if (!isFullscreen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsFullscreen(false);
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

  const candlesQ = useCandles(token, intervalMin, 320, pollMs);
  const liveLtpQ = useLiveLtp(token, socketConnected ? 1000 : 1500);
  const rows: CandleRow[] = candlesQ.data?.rows || [];
  const rowsToday = React.useMemo(() => {
    if (!rows.length || !Number.isFinite(serverNowMs)) return rows;
    const dayStartMs = getIstDayStartMs(serverNowMs);
    const dayEndMs = dayStartMs + 24 * 60 * 60 * 1000;
    return rows.filter((row) => {
      const ts = new Date(row.ts).getTime();
      return Number.isFinite(ts) && ts >= dayStartMs && ts < dayEndMs;
    });
  }, [rows, serverNowMs]);

  const display = token !== null ? labelForToken(token, tokenLabels) : '-';
  const title = `Chart ${index + 1} • ${display} • ${intervalMin}m`;

  const errorMsg =
    (candlesQ.error as any)?.response?.data?.error || (candlesQ.error as any)?.message || null;

  const lastTs = rows.length ? rows[rows.length - 1]?.ts : null;
  const lastMs = lastTs ? new Date(lastTs).getTime() : NaN;
  const lagSec = Number.isFinite(lastMs) ? Math.max(0, (serverNowMs - lastMs) / 1000) : NaN;

  // Stale threshold: > 2 intervals behind (plus small grace).
  const staleCut = intervalMin * 60 * 2 + 15;
  const goodCut = intervalMin * 60 + 8;

  // Adaptive polling:
  // - When lag grows (no WS candle updates, or backend slow), speed up polling to catch up.
  // - When feed is healthy again, return to the baseline cadence.
  React.useEffect(() => {
    if (socketConnected) return;
    if (token === null) return;
    if (!Number.isFinite(lagSec)) return;

    const baseline = 2500;
    const next =
      lagSec > staleCut ? 1500 : lagSec > goodCut ? 2500 : baseline;

    if (pollMs !== next) setPollMs(next);
  }, [token, lagSec, staleCut, goodCut, socketConnected, pollMs]);

  const lagClass = !Number.isFinite(lagSec)
    ? ''
    : lagSec <= goodCut
      ? 'good'
      : lagSec <= staleCut
        ? 'warn'
        : 'bad';

  const liveLtp = pickLiveLtp(liveLtpQ.data);
  const fallbackLtp = rowsToday.length ? Number(rowsToday[rowsToday.length - 1]?.close) : NaN;
  const ltp = Number.isFinite(liveLtp) ? liveLtp : fallbackLtp;
  const openTrade = token !== null ? getLatestOpenTradeForToken(trades, token) : null;
  const breach = computeBreachState(openTrade, ltp);

  React.useEffect(() => {
    if (!onFeedHealth) return;
    onFeedHealth({
      index,
      token,
      intervalMin,
      lastTs,
      lagSec: Number.isFinite(lagSec) ? lagSec : null,
      stale: Number.isFinite(lagSec) ? lagSec > staleCut : false,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, token, intervalMin, lastTs, lagSec, staleCut]);

  return (
    <div id={panelId} className={['panel', isFullscreen ? 'panelFullscreen' : '', isFocused ? 'panelFocus' : ''].join(' ')}>
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
              onChange={(e) => onChange({ ...config, intervalMin: Number(e.target.value) })}
            >
              <option value={1}>1m</option>
              <option value={3}>3m</option>
              <option value={5}>5m</option>
            </select>
          </div>

          <div className="field">
            <label>Overlay</label>
            <select
              className="small"
              value={overlayN}
              onChange={(e) => setOverlayN(Number(e.target.value))}
              title="Show faint ENTRY/SL/TGT levels for last N trades (context). Active trade lines always show."
            >
              <option value={0}>Active</option>
              <option value={3}>Last 3</option>
              <option value={5}>Last 5</option>
              <option value={10}>Last 10</option>
            </select>
          </div>

          <span
            className={['pill', socketConnected ? 'good' : 'warn'].join(' ')}
            title={
              socketConnected
                ? 'WS connected • polling disabled'
                : `Polling ${pollMs}ms`
            }
          >
            {socketConnected ? 'WS' : 'POLL'}
          </span>

          {token !== null && rows.length ? (
            <span className={['pill', lagClass].join(' ')} title={lastTs ? `Last candle ts: ${lastTs}` : 'Last candle ts: n/a'}>
              lag: {formatLagSeconds(lagSec)}
            </span>
          ) : null}

          {breach !== 'NORMAL' ? (
            <span
              className={['pill', breach === 'SL' ? 'bad' : 'good'].join(' ')}
              title={
                Number.isFinite(liveLtp)
                  ? 'Based on live LTP'
                  : 'Based on latest candle close (proxy for LTP)'
              }
            >
              {breach === 'SL' ? 'SL BREACH' : 'TGT HIT'}
            </span>
          ) : null}

          <div className="smallText">
            {candlesQ.isFetching
              ? 'updating…'
              : candlesQ.data
                ? `candles: ${rowsToday.length}`
                : 'no data'}
          </div>
        </div>

        <div className="panelHeaderActions">
          <div className="smallText">{tradesLoading ? 'trades…' : trades.length ? `trades: ${trades.length}` : ''}</div>
          <button className="btn small" type="button" onClick={() => setIsFullscreen((prev) => !prev)}>
            {isFullscreen ? 'Close' : 'Full screen'}
          </button>
        </div>
      </div>

      <div className="chartWrap">
        {token !== null && rowsToday.length ? (
          <CandleChart
            key={`${token}-${intervalMin}`}
            token={token}
            title={title}
            candles={rowsToday}
            trades={trades}
            intervalMin={intervalMin}
            overlayCount={overlayN}
            liveLtp={Number.isFinite(liveLtp) ? liveLtp : undefined}
            currentMs={Number.isFinite(currentMs) ? currentMs : null}
          />
        ) : (
          <div className="panelPlaceholder">
            {token !== null
              ? 'Waiting for today’s candles… (need /admin/candles/recent)'
              : 'Select a token to load candles'}
          </div>
        )}
      </div>

      {errorMsg ? <div className="errorBox">{String(errorMsg)}</div> : null}
    </div>
  );
}
