import { useQuery } from '@tanstack/react-query';
import { getJson } from './http';
import { useSettings } from './settingsContext';
import type {
  CandleRow,
  TradeRow,
  StatusResponse,
  EquitySnapshot,
  PositionRow,
  OrderRow,
  RiskLimitsResponse,
  StrategyKpisResponse,
  ExecutionQualityResponse,
  MarketHealthResponse,
  AuditLogRow,
  AlertChannel,
  AlertIncident,
  TelemetrySnapshot,
  OptimizerSnapshot,
  RejectionsSnapshot,
  CostCalibrationResponse,
  MarketCalendarResponse,
  FnoUniverseResponse,
  CriticalHealthResponse,
  LiveLtpResponse,
} from '../types/backend';

export function useStatus(pollMs: number | false = 2000) {
  const { settings } = useSettings();
  return useQuery({
    queryKey: ['status', settings.baseUrl, settings.apiKey],
    queryFn: () => getJson<StatusResponse>(settings, '/admin/status'),
    refetchInterval: pollMs,
    retry: false
  });
}

export function useSubscriptions(pollMs: number | false = 5000) {
  const { settings } = useSettings();
  return useQuery({
    queryKey: ['subs', settings.baseUrl, settings.apiKey],
    queryFn: () => getJson<{ ok: boolean; count: number; tokens: number[] }>(settings, '/admin/subscriptions'),
    refetchInterval: pollMs,
    retry: false
  });
}

export function useTradesRecent(limit = 50, pollMs: number | false = 2000) {
  const { settings } = useSettings();
  return useQuery({
    queryKey: ['tradesRecent', settings.baseUrl, settings.apiKey, limit],
    queryFn: () => getJson<{ ok: boolean; rows: TradeRow[] }>(settings, '/admin/trades/recent', { limit }),
    refetchInterval: pollMs,
    retry: false
  });
}

export function useCandles(
  token: number | null,
  intervalMin: number,
  limit = 300,
  pollMs: number | false = 3000,
) {
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

export function useLiveLtp(token: number | null, pollMs: number | false = 1000) {
  const { settings } = useSettings();
  return useQuery({
    queryKey: ['ltp', settings.baseUrl, settings.apiKey, token],
    enabled: !!token,
    queryFn: () =>
      getJson<LiveLtpResponse>(settings, '/admin/ltp', {
        token,
      }),
    refetchInterval: pollMs,
    retry: false,
  });
}

export function useEquity(pollMs: number | false = 5000) {
  const { settings } = useSettings();
  return useQuery({
    queryKey: ['equity', settings.baseUrl, settings.apiKey],
    queryFn: () => getJson<EquitySnapshot>(settings, '/admin/account/equity'),
    refetchInterval: pollMs,
    retry: false,
  });
}

export function usePositions(pollMs: number | false = 5000) {
  const { settings } = useSettings();
  return useQuery({
    queryKey: ['positions', settings.baseUrl, settings.apiKey],
    queryFn: () => getJson<{ ok: boolean; rows: PositionRow[] }>(settings, '/admin/positions'),
    refetchInterval: pollMs,
    retry: false,
  });
}

export function useOrders(pollMs: number | false = 5000) {
  const { settings } = useSettings();
  return useQuery({
    queryKey: ['orders', settings.baseUrl, settings.apiKey],
    queryFn: () => getJson<{ ok: boolean; rows: OrderRow[] }>(settings, '/admin/orders'),
    refetchInterval: pollMs,
    retry: false,
  });
}

export function useRiskLimits(pollMs: number | false = 8000) {
  const { settings } = useSettings();
  return useQuery({
    queryKey: ['riskLimits', settings.baseUrl, settings.apiKey],
    queryFn: () => getJson<RiskLimitsResponse>(settings, '/admin/risk/limits'),
    refetchInterval: pollMs,
    retry: false,
  });
}

export function useStrategyKpis(pollMs: number | false = 8000) {
  const { settings } = useSettings();
  return useQuery({
    queryKey: ['strategyKpis', settings.baseUrl, settings.apiKey],
    queryFn: () => getJson<StrategyKpisResponse>(settings, '/admin/strategy/kpis', { limit: 200 }),
    refetchInterval: pollMs,
    retry: false,
  });
}

export function useExecutionQuality(pollMs: number | false = 8000) {
  const { settings } = useSettings();
  return useQuery({
    queryKey: ['executionQuality', settings.baseUrl, settings.apiKey],
    queryFn: () => getJson<ExecutionQualityResponse>(settings, '/admin/execution/quality', { limit: 200 }),
    refetchInterval: pollMs,
    retry: false,
  });
}

export function useMarketHealth(pollMs: number | false = 6000) {
  const { settings } = useSettings();
  return useQuery({
    queryKey: ['marketHealth', settings.baseUrl, settings.apiKey],
    queryFn: () => getJson<MarketHealthResponse>(settings, '/admin/market/health'),
    refetchInterval: pollMs,
    retry: false,
  });
}

export function useAuditLogs(pollMs: number | false = 10000) {
  const { settings } = useSettings();
  return useQuery({
    queryKey: ['auditLogs', settings.baseUrl, settings.apiKey],
    queryFn: () => getJson<{ ok: boolean; rows: AuditLogRow[] }>(settings, '/admin/audit/logs', { limit: 50 }),
    refetchInterval: pollMs,
    retry: false,
  });
}

export function useAlertChannels(pollMs: number | false = 12000) {
  const { settings } = useSettings();
  return useQuery({
    queryKey: ['alertChannels', settings.baseUrl, settings.apiKey],
    queryFn: () => getJson<{ ok: boolean; rows: AlertChannel[] }>(settings, '/admin/alerts/channels'),
    refetchInterval: pollMs,
    retry: false,
  });
}

export function useAlertIncidents(pollMs: number | false = 12000) {
  const { settings } = useSettings();
  return useQuery({
    queryKey: ['alertIncidents', settings.baseUrl, settings.apiKey],
    queryFn: () => getJson<{ ok: boolean; rows: AlertIncident[] }>(settings, '/admin/alerts/incidents', { limit: 50 }),
    refetchInterval: pollMs,
    retry: false,
  });
}

export function useTelemetrySnapshot(pollMs: number | false = 12000) {
  const { settings } = useSettings();
  return useQuery({
    queryKey: ['telemetrySnapshot', settings.baseUrl, settings.apiKey],
    queryFn: () => getJson<TelemetrySnapshot>(settings, '/admin/telemetry/snapshot'),
    refetchInterval: pollMs,
    retry: false,
  });
}

export function useTradeTelemetrySnapshot(pollMs: number | false = 12000) {
  const { settings } = useSettings();
  return useQuery({
    queryKey: ['tradeTelemetrySnapshot', settings.baseUrl, settings.apiKey],
    queryFn: () => getJson<TelemetrySnapshot>(settings, '/admin/trade-telemetry/snapshot'),
    refetchInterval: pollMs,
    retry: false,
  });
}

export function useOptimizerSnapshot(pollMs: number | false = 12000) {
  const { settings } = useSettings();
  return useQuery({
    queryKey: ['optimizerSnapshot', settings.baseUrl, settings.apiKey],
    queryFn: () => getJson<OptimizerSnapshot>(settings, '/admin/optimizer/snapshot'),
    refetchInterval: pollMs,
    retry: false,
  });
}

export function useRejections(pollMs: number | false = 15000) {
  const { settings } = useSettings();
  return useQuery({
    queryKey: ['rejections', settings.baseUrl, settings.apiKey],
    queryFn: () => getJson<RejectionsSnapshot>(settings, '/admin/rejections', { top: 20 }),
    refetchInterval: pollMs,
    retry: false,
  });
}

export function useCostCalibration(pollMs: number | false = 20000) {
  const { settings } = useSettings();
  return useQuery({
    queryKey: ['costCalibration', settings.baseUrl, settings.apiKey],
    queryFn: () => getJson<CostCalibrationResponse>(settings, '/admin/cost/calibration'),
    refetchInterval: pollMs,
    retry: false,
  });
}

export function useMarketCalendar(pollMs: number | false = 20000) {
  const { settings } = useSettings();
  return useQuery({
    queryKey: ['marketCalendar', settings.baseUrl, settings.apiKey],
    queryFn: () => getJson<MarketCalendarResponse>(settings, '/admin/market/calendar'),
    refetchInterval: pollMs,
    retry: false,
  });
}

export function useFnoUniverse(pollMs: number | false = 20000) {
  const { settings } = useSettings();
  return useQuery({
    queryKey: ['fnoUniverse', settings.baseUrl, settings.apiKey],
    queryFn: () => getJson<FnoUniverseResponse>(settings, '/admin/fno'),
    refetchInterval: pollMs,
    retry: false,
  });
}

export function useCriticalHealth(pollMs: number | false = 12000) {
  const { settings } = useSettings();
  return useQuery({
    queryKey: ['criticalHealth', settings.baseUrl, settings.apiKey],
    queryFn: () => getJson<CriticalHealthResponse>(settings, '/admin/health/critical'),
    refetchInterval: pollMs,
    retry: false,
  });
}
