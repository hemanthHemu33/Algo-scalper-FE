import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { io, type Socket } from "socket.io-client";
import { useSettings } from "./settingsContext";
import type { CandleRow, LiveLtpResponse, StatusResponse, TradeRow } from "../types/backend";

type SocketState = {
  connected: boolean;
  lastEvent: string | null;
};

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

    return () => {
      socket.removeAllListeners();
      socket.disconnect();
    };
  }, [queryClient, settings.apiKey, settings.baseUrl]);

  return { connected, lastEvent };
}
