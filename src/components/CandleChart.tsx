import React from "react";
import {
  createChart,
  type IChartApi,
  type ISeriesApi,
  type CandlestickData,
  type HistogramData,
  LineStyle,
} from "lightweight-charts";
import type { CandleRow, TradeRow } from "../types/backend";
import {
  toLwCandles,
  toLwVolume,
  buildTradeMarkers,
  getLatestTradeForToken,
} from "../lib/chartUtils";

type Props = {
  token: number;
  title: string;
  candles: CandleRow[];
  trades: TradeRow[];
  intervalMin: number;
};

export function CandleChart({ token, title, candles, trades, intervalMin }: Props) {
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const chartRef = React.useRef<IChartApi | null>(null);
  const candleSeriesRef = React.useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volSeriesRef = React.useRef<ISeriesApi<"Histogram"> | null>(null);
  const priceLinesRef = React.useRef<any[]>([]);
  const didInitViewRef = React.useRef(false);

  const lwCandles = React.useMemo(() => toLwCandles(candles), [candles]);
  const lwVol = React.useMemo(() => toLwVolume(candles), [candles]);

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

    const volData = lwVol.map((v) => ({
      time: v.time,
      value: v.value,
      color: "rgba(255,255,255,0.25)",
    })) as HistogramData[];
    vs.setData(volData);

    // markers
    const markers = buildTradeMarkers({
      token,
      trades,
      candles: lwCandles,
      max: 30,
    });
    cs.setMarkers(markers);

    // price lines for latest trade
    for (const pl of priceLinesRef.current) {
      try {
        cs.removePriceLine(pl);
      } catch {}
    }
    priceLinesRef.current = [];

    const latest = getLatestTradeForToken(trades, token);
    if (latest) {
      if (Number.isFinite(Number(latest.stopLoss))) {
        const pl = cs.createPriceLine({
          price: Number(latest.stopLoss),
          color: "rgba(255,107,107,0.9)",
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: true,
          title: "SL",
        });
        priceLinesRef.current.push(pl);
      }

      if (Number.isFinite(Number(latest.targetPrice))) {
        const pl = cs.createPriceLine({
          price: Number(latest.targetPrice),
          color: "rgba(46,229,157,0.9)",
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: true,
          title: "TGT",
        });
        priceLinesRef.current.push(pl);
      }
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
  }, [token, trades, lwCandles, lwVol]);

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
        {title}
      </div>
      <div ref={containerRef} className="chartContainer" />
    </div>
  );
}
