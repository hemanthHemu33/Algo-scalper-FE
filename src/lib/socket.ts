import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { io, type Socket } from "socket.io-client";
import { useSettings } from "./settingsContext";
import type { CandleRow, StatusResponse, TradeRow } from "../types/backend";

type SocketState = {
  connected: boolean;
  lastEvent: string | null;
  socket: Socket | null;
};

type TradesPayload = {
  ok?: boolean;
  rows?: TradeRow[];
};

type ChartPayload = {
  ok?: boolean;
  chartId?: string;
  token?: number;
  intervalMin?: number;
  rows?: CandleRow[];
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
      new Date(b.createdAt || b.updatedAt || 0).getTime() -
      new Date(a.createdAt || a.updatedAt || 0).getTime(),
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
  const [socket, setSocket] = useState<Socket | null>(null);

  useEffect(() => {
    const baseUrl = normalizeBaseUrl(settings.baseUrl);
    if (!baseUrl) return;

    const liveSocket: Socket = io(baseUrl, {
      path: SOCKET_PATH,
      transports: ["websocket"],
      auth: settings.apiKey ? { apiKey: settings.apiKey } : undefined,
      query: settings.apiKey ? { apiKey: settings.apiKey } : undefined,
    });
    setSocket(liveSocket);

    const statusKey = ["status", baseUrl, settings.apiKey];
    const subsKey = ["subs", baseUrl, settings.apiKey];
    const tradesKeyPrefix = ["tradesRecent", baseUrl, settings.apiKey];
    const candlesKeyPrefix = ["candles", baseUrl, settings.apiKey];

    const updateStatus = (payload: StatusResponse) => {
      if (!payload) return;
      queryClient.setQueryData(statusKey, payload);
      setLastEvent("status");
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

    const updateTrades = (payload: TradesPayload) => {
      const incoming = payload?.rows || [];
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

    const updateCandles = (payload: ChartPayload) => {
      const rows = payload?.rows || [];
      if (!rows.length) return;
      const token = payload?.token || rows[0]?.instrument_token;
      const intervalMin = payload?.intervalMin || rows[0]?.interval_min;

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

    liveSocket.on("connect", () => {
      setConnected(true);
      liveSocket.emit("status:subscribe", {});
      liveSocket.emit("subs:subscribe", {});
      liveSocket.emit("trades:subscribe", { limit: 80 });
    });
    liveSocket.on("disconnect", () => setConnected(false));
    liveSocket.on("status:update", updateStatus);
    liveSocket.on("subs:update", updateSubscriptions);
    liveSocket.on("trades:snapshot", updateTrades);
    liveSocket.on("trades:delta", updateTrades);
    liveSocket.on("chart:snapshot", updateCandles);
    liveSocket.on("chart:delta", updateCandles);

    return () => {
      liveSocket.emit("status:unsubscribe");
      liveSocket.emit("subs:unsubscribe");
      liveSocket.emit("trades:unsubscribe");
      liveSocket.removeAllListeners();
      liveSocket.disconnect();
      setSocket(null);
    };
  }, [queryClient, settings.apiKey, settings.baseUrl]);

  return useMemo(
    () => ({
      connected,
      lastEvent,
      socket,
    }),
    [connected, lastEvent, socket],
  );
}

export function useChartSocket(opts: {
  chartId: string;
  token: number | null;
  intervalMin: number;
  limit: number;
  socket: Socket | null;
  connected: boolean;
}) {
  const { chartId, token, intervalMin, limit, socket, connected } = opts;

  useEffect(() => {
    if (!socket || !connected || !token) return;
    socket.emit("chart:subscribe", {
      chartId,
      token,
      intervalMin,
      limit,
    });
    return () => {
      socket.emit("chart:unsubscribe", { chartId });
    };
  }, [chartId, connected, intervalMin, limit, socket, token]);
}
