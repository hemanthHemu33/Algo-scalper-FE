import React from "react";
import { CandleChart } from "./CandleChart";
import { useCandles } from "../lib/hooks";
import type { CandleRow, TradeRow } from "../types/backend";

export type ChartConfig = {
  token: number | null;
  intervalMin: number;
};

type Props = {
  index: number;
  config: ChartConfig;
  tokens: number[];
  trades: TradeRow[];
  tradesLoading: boolean;
  socketConnected: boolean;
  onChange: (next: ChartConfig) => void;
};

function tokenLabel(t: number | null) {
  if (t === null) return "Select token";
  return String(t);
}

export function ChartPanel({
  index,
  config,
  tokens,
  trades,
  tradesLoading,
  socketConnected,
  onChange,
}: Props) {
  const [isFullscreen, setIsFullscreen] = React.useState(false);
  const token = config.token;
  const intervalMin = config.intervalMin;

  React.useEffect(() => {
    if (!isFullscreen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsFullscreen(false);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [isFullscreen]);

  React.useEffect(() => {
    if (!isFullscreen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [isFullscreen]);

  // When the websocket is connected, candles are streamed into the React Query cache.
  // Avoid polling in that case (it causes duplicate load and can make the UI feel "laggy").
  const candlesQ = useCandles(
    token,
    intervalMin,
    320,
    socketConnected ? false : 2500,
  );

  const rows: CandleRow[] = candlesQ.data?.rows || [];

  const title = `Chart ${index + 1} • token ${token ?? "-"} • ${intervalMin}m`;

  const errorMsg =
    (candlesQ.error as any)?.response?.data?.error ||
    (candlesQ.error as any)?.message ||
    null;

  return (
    <div className={["panel", isFullscreen ? "panelFullscreen" : ""].join(" ")}>
      <div className="panelHeader">
        <div className="left">
          <div className="field">
            <label>Token</label>
            <select
              className="small"
              value={token ?? ""}
              onChange={(e) =>
                onChange({
                  ...config,
                  token: e.target.value ? Number(e.target.value) : null,
                })
              }
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
              ? "updating…"
              : candlesQ.data
                ? `candles: ${rows.length}`
                : "no data"}
          </div>
        </div>

        <div className="panelHeaderActions">
          <div className="smallText">
            {tradesLoading
              ? "trades…"
              : trades.length
                ? `trades: ${trades.length}`
                : ""}
          </div>
          <button
            className="btn small"
            type="button"
            onClick={() => setIsFullscreen((prev) => !prev)}
          >
            {isFullscreen ? "Close" : "Full screen"}
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
          <div
            style={{
              padding: 12,
              color: "rgba(255,255,255,0.65)",
              fontSize: 12,
            }}
          >
            {token !== null
              ? "Waiting for candles… (need /admin/candles/recent)"
              : "Select a token to load candles"}
          </div>
        )}
      </div>

      {errorMsg ? <div className="errorBox">{String(errorMsg)}</div> : null}
    </div>
  );
}
