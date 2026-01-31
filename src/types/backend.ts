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
