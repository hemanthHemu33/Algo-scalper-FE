import { useQuery } from '@tanstack/react-query';
import { getJson } from './http';
import { useSettings } from './settingsContext';
import type { CandleRow, TradeRow, StatusResponse } from '../types/backend';

export function useStatus(pollMs = 2000) {
  const { settings } = useSettings();
  return useQuery({
    queryKey: ['status', settings.baseUrl, settings.apiKey],
    queryFn: () => getJson<StatusResponse>(settings, '/admin/status'),
    refetchInterval: pollMs,
    retry: false
  });
}

export function useSubscriptions(pollMs = 5000) {
  const { settings } = useSettings();
  return useQuery({
    queryKey: ['subs', settings.baseUrl, settings.apiKey],
    queryFn: () => getJson<{ ok: boolean; count: number; tokens: number[] }>(settings, '/admin/subscriptions'),
    refetchInterval: pollMs,
    retry: false
  });
}

export function useTradesRecent(limit = 50, pollMs = 2000) {
  const { settings } = useSettings();
  return useQuery({
    queryKey: ['tradesRecent', settings.baseUrl, settings.apiKey, limit],
    queryFn: () => getJson<{ ok: boolean; rows: TradeRow[] }>(settings, '/admin/trades/recent', { limit }),
    refetchInterval: pollMs,
    retry: false
  });
}

export function useCandles(token: number | null, intervalMin: number, limit = 300, pollMs = 3000) {
  const { settings } = useSettings();
  return useQuery({
    queryKey: ['candles', settings.baseUrl, settings.apiKey, token, intervalMin, limit],
    enabled: !!token,
    queryFn: () =>
      getJson<{ ok: boolean; rows: CandleRow[] }>(settings, '/admin/candles/recent', {
        token,
        intervalMin,
        limit,
      }),
    refetchInterval: pollMs,
    retry: false,
  });
}
