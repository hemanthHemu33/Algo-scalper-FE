import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { io, type Socket } from "socket.io-client";
import { useSettings } from "./settingsContext";
import type {
  AlertChannel,
  AlertIncident,
  AuditLogRow,
  CandleRow,
  CostCalibrationResponse,
  CriticalHealthResponse,
  EquitySnapshot,
  ExecutionQualityResponse,
  FnoUniverseResponse,
  LiveLtpResponse,
  MarketCalendarResponse,
  MarketHealthResponse,
  OptimizerSnapshot,
  OrderRow,
  PositionRow,
  RejectionsSnapshot,
  RiskLimitsResponse,
  StatusResponse,
  StrategyKpisResponse,
  TelemetrySnapshot,
  TradeRow,
} from "../types/backend";

type SocketState = {
  connected: boolean;
  lastEvent: string | null;
};

type RowsPayload<T> = { ok?: boolean; rows?: T[] };

type CandlePayload =
  | {
      token?: number;
      intervalMin?: number;
      rows?: CandleRow[];
    }
  | CandleRow;

type LtpPayload = LiveLtpResponse & {
  instrument_token?: number;
};

const SOCKET_PATH = import.meta.env.VITE_SOCKET_PATH || "/socket.io";

function normalizeBaseUrl(baseUrl: string) {
  return baseUrl.trim().replace(/\/$/, "");
}

function mergeTrades(existing: TradeRow[], incoming: TradeRow[], limit: number) {
  const map = new Map<string, TradeRow>();
  for (const row of existing || []) {
    if (row?.tradeId) map.set(String(row.tradeId), row);
  }
  for (const row of incoming || []) {
    if (row?.tradeId) map.set(String(row.tradeId), row);
  }
  const merged = Array.from(map.values());
  merged.sort(
    (a, b) =>
      new Date(b.updatedAt || b.createdAt || 0).getTime() -
      new Date(a.updatedAt || a.createdAt || 0).getTime(),
  );
  return merged.slice(0, limit);
}

function mergeCandles(
  existing: CandleRow[],
  incoming: CandleRow[],
  limit: number,
) {
  const map = new Map<string, CandleRow>();
  for (const row of existing || []) {
    if (row?.ts) map.set(String(row.ts), row);
  }
  for (const row of incoming || []) {
    if (row?.ts) map.set(String(row.ts), row);
  }
  const merged = Array.from(map.values());
  merged.sort(
    (a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime(),
  );
  return merged.slice(-limit);
}

export function useSocketBridge(): SocketState {
  const { settings } = useSettings();
  const queryClient = useQueryClient();
  const [connected, setConnected] = useState(false);
  const [lastEvent, setLastEvent] = useState<string | null>(null);

  useEffect(() => {
    const baseUrl = normalizeBaseUrl(settings.baseUrl);
    if (!baseUrl) return;

    const socket: Socket = io(baseUrl, {
      path: SOCKET_PATH,
      transports: ["websocket"],
      auth: settings.apiKey ? { apiKey: settings.apiKey } : undefined,
      query: settings.apiKey ? { apiKey: settings.apiKey } : undefined,
    });

    const statusKey = ["status", baseUrl, settings.apiKey];
    const subsKey = ["subs", baseUrl, settings.apiKey];
    const tradesKeyPrefix = ["tradesRecent", baseUrl, settings.apiKey];
    const candlesKeyPrefix = ["candles", baseUrl, settings.apiKey];
    const ltpKeyPrefix = ["ltp", baseUrl, settings.apiKey];
    const equityKey = ["equity", baseUrl, settings.apiKey];
    const positionsKey = ["positions", baseUrl, settings.apiKey];
    const ordersKey = ["orders", baseUrl, settings.apiKey];
    const riskLimitsKey = ["riskLimits", baseUrl, settings.apiKey];
    const strategyKpisKey = ["strategyKpis", baseUrl, settings.apiKey];
    const executionQualityKey = ["executionQuality", baseUrl, settings.apiKey];
    const marketHealthKey = ["marketHealth", baseUrl, settings.apiKey];
    const auditLogsKey = ["auditLogs", baseUrl, settings.apiKey];
    const alertChannelsKey = ["alertChannels", baseUrl, settings.apiKey];
    const alertIncidentsKey = ["alertIncidents", baseUrl, settings.apiKey];
    const telemetryKey = ["telemetrySnapshot", baseUrl, settings.apiKey];
    const tradeTelemetryKey = ["tradeTelemetrySnapshot", baseUrl, settings.apiKey];
    const optimizerKey = ["optimizerSnapshot", baseUrl, settings.apiKey];
    const rejectionsKey = ["rejections", baseUrl, settings.apiKey];
    const costCalibrationKey = ["costCalibration", baseUrl, settings.apiKey];
    const marketCalendarKey = ["marketCalendar", baseUrl, settings.apiKey];
    const fnoUniverseKey = ["fnoUniverse", baseUrl, settings.apiKey];
    const criticalHealthKey = ["criticalHealth", baseUrl, settings.apiKey];

    const updateStatus = (payload: StatusResponse) => {
      if (!payload) return;
      queryClient.setQueryData(statusKey, payload);
      setLastEvent("status");
    };

    const updateEquity = (payload: EquitySnapshot) => {
      if (!payload) return;
      queryClient.setQueryData(equityKey, payload);
      setLastEvent("equity");
    };

    const updatePositions = (payload: RowsPayload<PositionRow>) => {
      if (!payload) return;
      queryClient.setQueryData(positionsKey, payload);
      setLastEvent("positions");
    };

    const updateOrders = (payload: RowsPayload<OrderRow>) => {
      if (!payload) return;
      queryClient.setQueryData(ordersKey, payload);
      setLastEvent("orders");
    };

    const updateRiskLimits = (payload: RiskLimitsResponse) => {
      if (!payload) return;
      queryClient.setQueryData(riskLimitsKey, payload);
      setLastEvent("riskLimits");
    };

    const updateStrategyKpis = (payload: StrategyKpisResponse) => {
      if (!payload) return;
      queryClient.setQueryData(strategyKpisKey, payload);
      setLastEvent("strategyKpis");
    };

    const updateExecutionQuality = (payload: ExecutionQualityResponse) => {
      if (!payload) return;
      queryClient.setQueryData(executionQualityKey, payload);
      setLastEvent("executionQuality");
    };

    const updateMarketHealth = (payload: MarketHealthResponse) => {
      if (!payload) return;
      queryClient.setQueryData(marketHealthKey, payload);
      setLastEvent("marketHealth");
    };

    const updateAuditLogs = (payload: RowsPayload<AuditLogRow>) => {
      if (!payload) return;
      queryClient.setQueryData(auditLogsKey, payload);
      setLastEvent("auditLogs");
    };

    const updateAlertChannels = (payload: RowsPayload<AlertChannel>) => {
      if (!payload) return;
      queryClient.setQueryData(alertChannelsKey, payload);
      setLastEvent("alertChannels");
    };

    const updateAlertIncidents = (payload: RowsPayload<AlertIncident>) => {
      if (!payload) return;
      queryClient.setQueryData(alertIncidentsKey, payload);
      setLastEvent("alertIncidents");
    };

    const updateTelemetry = (payload: TelemetrySnapshot) => {
      if (!payload) return;
      queryClient.setQueryData(telemetryKey, payload);
      setLastEvent("telemetrySnapshot");
    };

    const updateTradeTelemetry = (payload: TelemetrySnapshot) => {
      if (!payload) return;
      queryClient.setQueryData(tradeTelemetryKey, payload);
      setLastEvent("tradeTelemetrySnapshot");
    };

    const updateOptimizer = (payload: OptimizerSnapshot) => {
      if (!payload) return;
      queryClient.setQueryData(optimizerKey, payload);
      setLastEvent("optimizerSnapshot");
    };

    const updateRejections = (payload: RejectionsSnapshot) => {
      if (!payload) return;
      queryClient.setQueryData(rejectionsKey, payload);
      setLastEvent("rejections");
    };

    const updateCostCalibration = (payload: CostCalibrationResponse) => {
      if (!payload) return;
      queryClient.setQueryData(costCalibrationKey, payload);
      setLastEvent("costCalibration");
    };

    const updateMarketCalendar = (payload: MarketCalendarResponse) => {
      if (!payload) return;
      queryClient.setQueryData(marketCalendarKey, payload);
      setLastEvent("marketCalendar");
    };

    const updateFnoUniverse = (payload: FnoUniverseResponse) => {
      if (!payload) return;
      queryClient.setQueryData(fnoUniverseKey, payload);
      setLastEvent("fnoUniverse");
    };

    const updateCriticalHealth = (payload: CriticalHealthResponse) => {
      if (!payload) return;
      queryClient.setQueryData(criticalHealthKey, payload);
      setLastEvent("criticalHealth");
    };

    const updateSubscriptions = (payload: {
      ok?: boolean;
      count?: number;
      tokens?: number[];
    }) => {
      if (!payload) return;
      queryClient.setQueryData(subsKey, payload);
      setLastEvent("subscriptions");
    };

    const updateTrades = (payload: TradeRow | TradeRow[]) => {
      const incoming = Array.isArray(payload) ? payload : [payload];
      if (!incoming.length) return;
      const queries = queryClient
        .getQueryCache()
        .findAll({ queryKey: tradesKeyPrefix });
      for (const q of queries) {
        const key = q.queryKey as (string | number)[];
        const limit = Number(key[3]) || 80;
        queryClient.setQueryData(key, (old) => {
          const prevRows = (old as { rows?: TradeRow[] } | undefined)?.rows || [];
          return { ok: true, rows: mergeTrades(prevRows, incoming, limit) };
        });
      }
      setLastEvent("trades");
    };

    const updateCandles = (payload: CandlePayload) => {
      if (!payload) return;
      const rows = Array.isArray((payload as any).rows)
        ? ((payload as any).rows as CandleRow[])
        : [payload as CandleRow];
      if (!rows.length) return;

      const token =
        (payload as any).token ||
        (payload as CandleRow).instrument_token ||
        rows[0]?.instrument_token;
      const intervalMin =
        (payload as any).intervalMin ||
        (payload as CandleRow).interval_min ||
        rows[0]?.interval_min;

      if (!token || !intervalMin) return;

      const queries = queryClient
        .getQueryCache()
        .findAll({ queryKey: candlesKeyPrefix });
      for (const q of queries) {
        const key = q.queryKey as (string | number)[];
        const keyToken = Number(key[3]);
        const keyInterval = Number(key[4]);
        const limit = Number(key[5]) || 320;
        if (keyToken !== Number(token) || keyInterval !== Number(intervalMin))
          continue;
        queryClient.setQueryData(key, (old) => {
          const prevRows = (old as { rows?: CandleRow[] } | undefined)?.rows || [];
          return { ok: true, rows: mergeCandles(prevRows, rows, limit) };
        });
      }
      setLastEvent("candles");
    };

    const updateLtp = (payload: LtpPayload | LtpPayload[]) => {
      const incoming = Array.isArray(payload) ? payload : [payload];
      if (!incoming.length) return;
      const queries = queryClient
        .getQueryCache()
        .findAll({ queryKey: ltpKeyPrefix });
      for (const row of incoming) {
        const token = Number(
          row?.token ?? row?.instrument_token,
        );
        if (!Number.isFinite(token)) continue;
        for (const q of queries) {
          const key = q.queryKey as (string | number)[];
          const keyToken = Number(key[3]);
          if (keyToken !== token) continue;
          queryClient.setQueryData(key, (old) => ({
            ...(old as LiveLtpResponse | undefined),
            ...row,
            token,
            ok: true,
          }));
        }
      }
      setLastEvent("ltp");
    };

    socket.on("connect", () => setConnected(true));
    socket.on("disconnect", () => setConnected(false));
    socket.on("status", updateStatus);
    socket.on("status:update", updateStatus);
    socket.on("subscriptions", updateSubscriptions);
    socket.on("subs", updateSubscriptions);
    socket.on("trade", updateTrades);
    socket.on("trades", updateTrades);
    socket.on("trades:recent", updateTrades);
    socket.on("candle", updateCandles);
    socket.on("candles", updateCandles);
    socket.on("candles:recent", updateCandles);
    socket.on("ltp", updateLtp);
    socket.on("ltp:update", updateLtp);
    socket.on("tick", updateLtp);
    socket.on("equity", updateEquity);
    socket.on("equity:update", updateEquity);
    socket.on("positions", updatePositions);
    socket.on("positions:update", updatePositions);
    socket.on("orders", updateOrders);
    socket.on("orders:update", updateOrders);
    socket.on("risk:limits", updateRiskLimits);
    socket.on("riskLimits", updateRiskLimits);
    socket.on("strategy:kpis", updateStrategyKpis);
    socket.on("strategyKpis", updateStrategyKpis);
    socket.on("execution:quality", updateExecutionQuality);
    socket.on("executionQuality", updateExecutionQuality);
    socket.on("market:health", updateMarketHealth);
    socket.on("marketHealth", updateMarketHealth);
    socket.on("audit:logs", updateAuditLogs);
    socket.on("auditLogs", updateAuditLogs);
    socket.on("alerts:channels", updateAlertChannels);
    socket.on("alertChannels", updateAlertChannels);
    socket.on("alerts:incidents", updateAlertIncidents);
    socket.on("alertIncidents", updateAlertIncidents);
    socket.on("telemetry", updateTelemetry);
    socket.on("telemetry:snapshot", updateTelemetry);
    socket.on("tradeTelemetry", updateTradeTelemetry);
    socket.on("tradeTelemetry:snapshot", updateTradeTelemetry);
    socket.on("optimizer", updateOptimizer);
    socket.on("optimizer:snapshot", updateOptimizer);
    socket.on("rejections", updateRejections);
    socket.on("cost:calibration", updateCostCalibration);
    socket.on("costCalibration", updateCostCalibration);
    socket.on("market:calendar", updateMarketCalendar);
    socket.on("marketCalendar", updateMarketCalendar);
    socket.on("fno", updateFnoUniverse);
    socket.on("fnoUniverse", updateFnoUniverse);
    socket.on("health:critical", updateCriticalHealth);
    socket.on("criticalHealth", updateCriticalHealth);

    return () => {
      socket.removeAllListeners();
      socket.disconnect();
    };
  }, [queryClient, settings.apiKey, settings.baseUrl]);

  return { connected, lastEvent };
}
