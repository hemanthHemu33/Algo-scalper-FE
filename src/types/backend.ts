export type CandleRow = {
  instrument_token: number;
  interval_min: number;
  ts: string; // ISO date string from Mongo/Express
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
};

export type TradeRow = {
  tradeId: string;
  instrument_token: number;
  instrument?: {
    tradingsymbol?: string;
    exchange?: string;
    segment?: string;
  };
  strategyId?: string;
  side?: 'BUY' | 'SELL';
  qty?: number;
  entryPrice?: number | null;
  exitPrice?: number | null;
  stopLoss?: number | null;
  targetPrice?: number | null;
  tp1Price?: number | null;
  status?: string;
  closeReason?: string;
  createdAt?: string;
  updatedAt?: string;
};

export type StatusResponse = {
  ok: boolean;
  tradingEnabled?: boolean;
  killSwitch?: boolean;
  halted?: boolean;
  haltInfo?: any;
  tradesToday?: number;
  ordersPlacedToday?: number;
  activeTradeId?: string | null;
  activeTrade?: any;
  ticker?: {
    connected?: boolean;
    lastDisconnect?: string | null;
    hasSession?: boolean;
  };
  now?: string;
};

export type EquitySnapshot = {
  ok: boolean;
  asOf?: string;
  equity?: number;
  availableMargin?: number;
  usedMargin?: number;
  realizedPnl?: number;
  unrealizedPnl?: number;
  cash?: number;
  breakdown?: Record<string, number>;
};

export type PositionRow = {
  instrument_token?: number;
  tradingsymbol?: string;
  exchange?: string;
  quantity?: number;
  averagePrice?: number;
  lastPrice?: number;
  pnl?: number;
  exposureInr?: number;
};

export type OrderRow = {
  order_id?: string;
  exchange_order_id?: string;
  tradingsymbol?: string;
  status?: string;
  transaction_type?: string;
  price?: number;
  quantity?: number;
  filled_quantity?: number;
  order_timestamp?: string;
};

export type RiskLimitsResponse = {
  ok: boolean;
  maxDailyLoss?: number;
  maxDrawdown?: number;
  maxOpenTrades?: number;
  maxExposureInr?: number;
  usage?: {
    openPositions?: number;
    exposureBySymbol?: Record<string, number>;
  };
};

export type StrategyKpiRow = {
  strategyId: string;
  trades: number;
  winRate?: number;
  pnl?: number;
  avgHoldMin?: number;
  sharpe?: number;
  maxDrawdown?: number;
};

export type StrategyKpisResponse = {
  ok: boolean;
  rows?: StrategyKpiRow[];
};

export type ExecutionQualityResponse = {
  ok: boolean;
  fillRate?: number;
  avgSlippage?: number;
  avgLatencyMs?: number;
  rejects?: number;
  rows?: Array<Record<string, any>>;
};

export type MarketHealthResponse = {
  ok: boolean;
  tokens?: Array<{
    token: number;
    lagSec?: number;
    lastTs?: string;
    stale?: boolean;
  }>;
  status?: string;
};

export type AuditLogRow = {
  actor?: string | null;
  action?: string;
  resource?: string;
  status?: string;
  meta?: any;
  createdAt?: string;
};

export type AlertChannel = {
  _id?: string;
  type?: string;
  enabled?: boolean;
};

export type AlertIncident = {
  _id?: string;
  type?: string;
  message?: string;
  severity?: string;
  createdAt?: string;
};

export type TelemetrySnapshot = {
  ok: boolean;
  data?: Record<string, any>;
};

export type OptimizerSnapshot = {
  ok: boolean;
  data?: Record<string, any>;
};

export type RejectionsSnapshot = {
  ok: boolean;
  source?: string;
  data?: Record<string, any>;
  top?: {
    bySymbol?: Array<{ key: string; count: number }>;
  };
};

export type CostCalibrationResponse = {
  ok: boolean;
  calibration?: Record<string, any>;
  recentRuns?: Array<Record<string, any>>;
};

export type MarketCalendarResponse = {
  ok: boolean;
  meta?: Record<string, any>;
};

export type FnoUniverseResponse = {
  ok?: boolean;
  enabled?: boolean;
  universe?: Record<string, any>;
};
