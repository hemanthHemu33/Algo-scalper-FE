import React from "react";
import {
  createChart,
  type IChartApi,
  type ISeriesApi,
  type CandlestickData,
  type HistogramData,
  LineStyle,
  TickMarkType,
  type Time,
} from "lightweight-charts";
import type { CandleRow, TradeRow } from "../types/backend";
import {
  toLwCandles,
  toLwVolume,
  buildTradeMarkers,
  getLatestOpenTradeForToken,
  getLastTradesForToken,
  formatIstDateTime,
  formatIstTick,
} from "../lib/chartUtils";

type Props = {
  token: number;
  title: string;
  candles: CandleRow[];
  trades: TradeRow[];
  intervalMin: number;
  overlayCount?: number;
};


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
export function CandleChart({ token, title, candles, trades, intervalMin, overlayCount = 0 }: Props) {
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const chartRef = React.useRef<IChartApi | null>(null);
  const candleSeriesRef = React.useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volSeriesRef = React.useRef<ISeriesApi<"Histogram"> | null>(null);
  const priceLinesRef = React.useRef<any[]>([]);
  const didInitViewRef = React.useRef(false);

  const lwCandles = React.useMemo(() => toLwCandles(candles), [candles]);
  const lwVol = React.useMemo(() => toLwVolume(candles), [candles]);

  const lastCandle = candles.length ? candles[candles.length - 1] : null;
  const ltp = lastCandle ? Number(lastCandle.close) : NaN;
  const openTrade = React.useMemo(() => getLatestOpenTradeForToken(trades, token), [trades, token]);
  const breach = computeBreachState(openTrade, ltp);

  React.useEffect(() => {
    didInitViewRef.current = false;
  }, [token, intervalMin]);

  // init chart once
  React.useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const chart = createChart(el, {
      layout: {
        background: { color: "rgba(0,0,0,0)" },
        textColor: "rgba(255,255,255,0.85)",
      },
      grid: {
        vertLines: { color: "rgba(255,255,255,0.06)" },
        horzLines: { color: "rgba(255,255,255,0.06)" },
      },
      rightPriceScale: {
        borderColor: "rgba(255,255,255,0.10)",
      },
      timeScale: {
        borderColor: "rgba(255,255,255,0.10)",
        timeVisible: true,
        secondsVisible: false,
        tickMarkFormatter: (time: Time, tickMarkType: TickMarkType) =>
          formatIstTick(time, tickMarkType),
      },
      localization: {
        timeFormatter: (time: Time) => formatIstDateTime(time),
      },
      crosshair: {
        vertLine: {
          color: "rgba(106,166,255,0.35)",
          width: 1,
          style: LineStyle.Solid,
        },
        horzLine: {
          color: "rgba(106,166,255,0.35)",
          width: 1,
          style: LineStyle.Solid,
        },
      },
      handleScroll: {
        mouseWheel: true,
        pressedMouseMove: true,
      },
      handleScale: {
        axisPressedMouseMove: true,
        mouseWheel: true,
        pinch: true,
      },
    });

    const candleSeries = chart.addCandlestickSeries({
      priceScaleId: "right",
      upColor: "#2ee59d",
      downColor: "#ff6b6b",
      borderUpColor: "#2ee59d",
      borderDownColor: "#ff6b6b",
      wickUpColor: "#2ee59d",
      wickDownColor: "#ff6b6b",
    });

    const volSeries = chart.addHistogramSeries({
      priceScaleId: "",
    });
    volSeries.priceScale().applyOptions({
      scaleMargins: { top: 0.8, bottom: 0 },
    });

    chartRef.current = chart;
    candleSeriesRef.current = candleSeries;
    volSeriesRef.current = volSeries;

    // ResizeObserver
    const ro = new ResizeObserver(() => {
      const { width, height } = el.getBoundingClientRect();
      chart.applyOptions({
        width: Math.floor(width),
        height: Math.floor(height),
      });
    });
    ro.observe(el);

    // initial size
    const { width, height } = el.getBoundingClientRect();
    chart.applyOptions({
      width: Math.floor(width),
      height: Math.floor(height),
    });

    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      volSeriesRef.current = null;
    };
  }, []);

  // update data
  React.useEffect(() => {
    const cs = candleSeriesRef.current;
    const vs = volSeriesRef.current;
    if (!cs || !vs) return;

    const data = lwCandles as CandlestickData[];
    cs.setData(data);

    // If the user drags the price axis, autoscale can get disabled.
    // Re-enable on every update so the right axis keeps tracking price.
    try {
      cs.priceScale().applyOptions({ autoScale: true });
    } catch {
      // ignore
    }

    const volData = lwVol.map((v) => ({
      time: v.time,
      value: v.value,
      color: "rgba(255,255,255,0.25)",
    })) as HistogramData[];
    vs.setData(volData);
    // markers (trade entries/exits)
    const markers = buildTradeMarkers({
      token,
      trades,
      candles: lwCandles,
      max: 30,
    });
    cs.setMarkers(markers);

    // price lines (LTP + trade levels)
    for (const pl of priceLinesRef.current) {
      try {
        cs.removePriceLine(pl);
      } catch {}
    }
    priceLinesRef.current = [];

    const lastBar = lwCandles.length ? lwCandles[lwCandles.length - 1] : null;
    const ltp = lastBar ? Number((lastBar as any).close) : NaN;

    const openTrade = getLatestOpenTradeForToken(trades, token);

    // Determine if LTP has crossed SL/TGT for the open trade (best-effort, based on latest candle close).
    let ltpState: 'NORMAL' | 'SL' | 'TGT' = 'NORMAL';
    if (openTrade && Number.isFinite(ltp)) {
      const side = (openTrade.side || '').toUpperCase();
      const sl = Number(openTrade.stopLoss);
      const tgt = Number(openTrade.targetPrice);

      if (side === 'BUY') {
        if (Number.isFinite(sl) && ltp <= sl) ltpState = 'SL';
        if (Number.isFinite(tgt) && ltp >= tgt) ltpState = 'TGT';
      } else if (side === 'SELL') {
        if (Number.isFinite(sl) && ltp >= sl) ltpState = 'SL';
        if (Number.isFinite(tgt) && ltp <= tgt) ltpState = 'TGT';
      }
    }

    // LTP line
    if (Number.isFinite(ltp)) {
      const ltpColor =
        ltpState === 'SL'
          ? 'rgba(255,107,107,0.95)'
          : ltpState === 'TGT'
            ? 'rgba(46,229,157,0.95)'
            : 'rgba(255,255,255,0.35)';

      const pl = cs.createPriceLine({
        price: ltp,
        color: ltpColor,
        lineWidth: 1,
        lineStyle: LineStyle.Dotted,
        lineVisible: true,
        axisLabelVisible: true,
        title: 'LTP',
      });
      priceLinesRef.current.push(pl);
    }

    // Open trade levels (ENTRY / SL / TGT)
    if (openTrade) {
      if (Number.isFinite(Number(openTrade.entryPrice))) {
        const pl = cs.createPriceLine({
          price: Number(openTrade.entryPrice),
          color: 'rgba(106,166,255,0.90)',
          lineWidth: 1,
          lineStyle: LineStyle.Solid,
          lineVisible: true,
          axisLabelVisible: true,
          title: 'ENTRY',
        });
        priceLinesRef.current.push(pl);
      }

      if (Number.isFinite(Number(openTrade.stopLoss))) {
        const pl = cs.createPriceLine({
          price: Number(openTrade.stopLoss),
          color: 'rgba(255,107,107,0.90)',
          lineWidth: 2,
          lineStyle: LineStyle.Dotted,
          lineVisible: true,
          axisLabelVisible: true,
          title: 'SL',
        });
        priceLinesRef.current.push(pl);
      }

      if (Number.isFinite(Number(openTrade.targetPrice))) {
        const pl = cs.createPriceLine({
          price: Number(openTrade.targetPrice),
          color: 'rgba(46,229,157,0.90)',
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          lineVisible: true,
          axisLabelVisible: true,
          title: 'TGT',
        });
        priceLinesRef.current.push(pl);
      }
    }

    // Optional: overlay last N trades (including closed) as faint levels for context.
    // This is intentionally subtle to avoid clutter.
    if (overlayCount && overlayCount > 0) {
      const lastTrades = getLastTradesForToken(trades, token, overlayCount);
      lastTrades.forEach((t, idx) => {
        // Skip the open trade if already drawn above, to avoid duplicating labels.
        if (openTrade && t.tradeId === openTrade.tradeId) return;

        const n = idx + 1;
        const alpha = 0.25;
        const entry = Number(t.entryPrice);
        const sl = Number(t.stopLoss);
        const tgt = Number(t.targetPrice);

        if (Number.isFinite(entry)) {
          const pl = cs.createPriceLine({
            price: entry,
            color: `rgba(106,166,255,${alpha})`,
            lineWidth: 1,
            lineStyle: LineStyle.Dotted,
            axisLabelVisible: false,
            title: `E#${n}`,
          });
          priceLinesRef.current.push(pl);
        }
        if (Number.isFinite(sl)) {
          const pl = cs.createPriceLine({
            price: sl,
            color: `rgba(255,107,107,${alpha})`,
            lineWidth: 1,
            lineStyle: LineStyle.Dotted,
            axisLabelVisible: false,
            title: `SL#${n}`,
          });
          priceLinesRef.current.push(pl);
        }
        if (Number.isFinite(tgt)) {
          const pl = cs.createPriceLine({
            price: tgt,
            color: `rgba(46,229,157,${alpha})`,
            lineWidth: 1,
            lineStyle: LineStyle.Dotted,
            axisLabelVisible: false,
            title: `T#${n}`,
          });
          priceLinesRef.current.push(pl);
        }
      });
    }

    // initial view: fit once; later keep at right edge without resetting zoom

    const chart = chartRef.current;
    if (chart && data.length) {
      if (!didInitViewRef.current) {
        chart.timeScale().fitContent();
        didInitViewRef.current = true;
      } else {
        chart.timeScale().scrollToRealTime();
      }
    }
  }, [token, trades, lwCandles, lwVol, overlayCount]);

  return (
    <div style={{ width: "100%", height: "100%", position: "relative" }}>
      <div
        style={{
          position: "absolute",
          top: 8,
          left: 10,
          zIndex: 2,
          fontSize: 12,
          color: "rgba(255,255,255,0.75)",
        }}
      >
        <div>{title}</div>
        {Number.isFinite(ltp) ? (
          <div style={{ marginTop: 2, fontSize: 11, color: breach === 'SL' ? 'rgba(255,107,107,0.95)' : breach === 'TGT' ? 'rgba(46,229,157,0.95)' : 'rgba(255,255,255,0.55)' }}>
            LTP: {ltp.toFixed(2)} {breach === 'SL' ? '• SL breach' : breach === 'TGT' ? '• target hit' : ''}
          </div>
        ) : null}
      </div>
      <div ref={containerRef} className="chartContainer" />
    </div>
  );
}
