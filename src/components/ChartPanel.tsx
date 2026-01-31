import { CandleChart } from './CandleChart';
import { useCandles, useTradesRecent } from '../lib/hooks';
import type { TradeRow } from '../types/backend';

export type ChartConfig = {
  token: number | null;
  intervalMin: number;
};

type Props = {
  index: number;
  config: ChartConfig;
  tokens: number[];
  onChange: (next: ChartConfig) => void;
};

function tokenLabel(t: number | null) {
  if (!t) return 'Select token';
  return String(t);
}

export function ChartPanel({ index, config, tokens, onChange }: Props) {
  const token = config.token;
  const intervalMin = config.intervalMin;

  const tradesQ = useTradesRecent(80, 2000);
  const candlesQ = useCandles(token, intervalMin, 320, 2500);

  const trades: TradeRow[] = tradesQ.data?.rows || [];
  const rows = candlesQ.data?.rows || [];

  const title = `Chart ${index + 1} • token ${token ?? '-'} • ${intervalMin}m`;

  const errorMsg = (candlesQ.error as any)?.response?.data?.error || (candlesQ.error as any)?.message || null;

  return (
    <div className="panel">
      <div className="panelHeader">
        <div className="left">
          <div className="field">
            <label>Token</label>
            <select
              className="small"
              value={token ?? ''}
              onChange={(e) => onChange({ ...config, token: e.target.value ? Number(e.target.value) : null })}
            >
              <option value="">{tokenLabel(null)}</option>
              {(tokens || []).map((t) => (
                <option key={t} value={t}>
                  {t}
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

          <div className="smallText">
            {candlesQ.isFetching ? 'updating…' : candlesQ.data ? `candles: ${rows.length}` : 'no data'}
          </div>
        </div>

        <div className="smallText">
          {tradesQ.isFetching ? 'trades…' : tradesQ.data ? `trades: ${trades.length}` : ''}
        </div>
      </div>

      <div className="chartWrap">
        {token && rows.length ? (
          <CandleChart token={token} title={title} candles={rows} trades={trades} />
        ) : (
          <div style={{ padding: 12, color: 'rgba(255,255,255,0.65)', fontSize: 12 }}>
            {token ? 'Waiting for candles… (need /admin/candles/recent)' : 'Select a token to load candles'}
          </div>
        )}
      </div>

      {errorMsg ? (
        <div className="errorBox">{String(errorMsg)}</div>
      ) : null}
    </div>
  );
}
