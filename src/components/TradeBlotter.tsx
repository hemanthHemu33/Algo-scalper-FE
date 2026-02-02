import React from "react";
import type { TradeRow } from "../types/backend";
import { formatPrettyInstrumentFromTrade } from "../lib/instrumentFormat";

type Limit = 20 | 50;

type Props = {
  trades: TradeRow[];
  limit: Limit;
  onLimitChange: (next: Limit) => void;
  tokenLabels: Record<number, string>;
  selectedToken?: number | null;
  onSelectToken?: (token: number, tradeId?: string) => void;
  onClose?: () => void;
};

const IST_TZ = "Asia/Kolkata";

function fmtNumber(n: number | string | null | undefined, digits = 2) {
  const v = Number(n);
  if (!Number.isFinite(v)) return "-";
  return v.toFixed(digits);
}

function fmtInt(n: number | string | null | undefined) {
  const v = Number(n);
  if (!Number.isFinite(v)) return "-";
  return String(Math.round(v));
}

function fmtIst(ts?: string) {
  if (!ts) return "-";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "-";
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: IST_TZ,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    day: "2-digit",
    month: "short",
  }).format(d);
}

function labelFor(trade: TradeRow, tokenLabels: Record<number, string>) {
  const tok = Number(trade.instrument_token);
  const pretty = formatPrettyInstrumentFromTrade(trade);
  if (pretty && pretty !== "-") return pretty;
  const fallback = tokenLabels?.[tok];
  return fallback ? String(fallback) : String(tok);
}

function calcPnl(trade: TradeRow) {
  const side = (trade.side || "").toUpperCase();
  const qty = Number(trade.qty);
  const entry = Number(trade.entryPrice);
  const exit = Number(trade.exitPrice);

  if (!Number.isFinite(qty) || !Number.isFinite(entry) || !Number.isFinite(exit))
    return null;

  const raw =
    side === "SELL"
      ? (entry - exit) * qty
      : side === "BUY"
        ? (exit - entry) * qty
        : null;

  if (!Number.isFinite(Number(raw))) return null;
  return Number(raw);
}

function statusClass(status?: string) {
  const s = (status || "").toUpperCase();
  if (!s) return "";
  if (s.includes("OPEN") || s.includes("ACTIVE")) return "warn";
  if (s.includes("CLOSED") || s.includes("DONE") || s.includes("EXIT")) return "good";
  if (s.includes("REJECT") || s.includes("CANCEL") || s.includes("FAIL")) return "bad";
  return "";
}

export function TradeBlotter({
  trades,
  limit,
  onLimitChange,
  tokenLabels,
  selectedToken,
  onSelectToken,
  onClose,
}: Props) {
  const [query, setQuery] = React.useState("");
  const [statusFilter, setStatusFilter] = React.useState<"ALL" | "OPEN" | "CLOSED" | "REJECT">("ALL");

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    return (trades || []).filter((t) => {
      const st = (t.status || "").toUpperCase();
      if (statusFilter === "OPEN" && !(st.includes("OPEN") || st.includes("ACTIVE"))) return false;
      if (statusFilter === "CLOSED" && !(st.includes("CLOSED") || st.includes("DONE") || st.includes("EXIT"))) return false;
      if (statusFilter === "REJECT" && !(st.includes("REJECT") || st.includes("CANCEL") || st.includes("FAIL"))) return false;

      if (!q) return true;
      const tok = String(t.instrument_token || "");
      const sym = String(t.instrument?.tradingsymbol || "");
      const pretty = formatPrettyInstrumentFromTrade(t);
      const strat = String(t.strategyId || "");
      const id = String(t.tradeId || "");
      const side = String(t.side || "");
      const reason = String(t.closeReason || "");
      return (
        tok.toLowerCase().includes(q) ||
        sym.toLowerCase().includes(q) ||
        pretty.toLowerCase().includes(q) ||
        strat.toLowerCase().includes(q) ||
        id.toLowerCase().includes(q) ||
        side.toLowerCase().includes(q) ||
        reason.toLowerCase().includes(q)
      );
    });
  }, [trades, query, statusFilter]);

  const rows = React.useMemo(() => filtered.slice(0, limit), [filtered, limit]);

  const downloadCsv = React.useCallback(() => {
    const header = [
      "time_ist",
      "label",
      "side",
      "qty",
      "entry",
      "exit",
      "status",
      "pnl",
      "tradeId",
      "strategyId",
      "closeReason",
      "stopLoss",
      "target",
      "token",
      "tradingsymbol",
    ];

    const lines = [header.join(",")];
    for (const t of rows) {
      const when = t.updatedAt || t.createdAt;
      const label = formatPrettyInstrumentFromTrade(t);
      const pnl = calcPnl(t);
      const safe = (v: any) => {
        const s = String(v ?? "");
        const needs = /[",\n]/.test(s);
        const escaped = s.replace(/"/g, '""');
        return needs ? `"${escaped}"` : escaped;
      };
      lines.push(
        [
          safe(fmtIst(when)),
          safe(label),
          safe(t.side),
          safe(t.qty),
          safe(t.entryPrice),
          safe(t.exitPrice),
          safe(t.status),
          safe(pnl === null ? "" : pnl.toFixed(2)),
          safe(t.tradeId),
          safe(t.strategyId),
          safe(t.closeReason),
          safe(t.stopLoss),
          safe(t.targetPrice),
          safe(t.instrument_token),
          safe(t.instrument?.tradingsymbol),
        ].join(",")
      );
    }

    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `trade_blotter_${limit}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }, [rows, limit]);

  return (
    <div className="panel blotter">
      <div className="panelHeader blotterHeader">
        <div className="left">
          <div style={{ fontWeight: 700 }}>Trade Blotter</div>
          <span className="pill">last {limit}</span>
        </div>

        <div className="panelHeaderActions">
          <div className="field">
            <label>Filter</label>
            <input
              className="small"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="symbol / strategy / status"
            />
          </div>

          <div className="field">
            <label>Status</label>
            <select className="small" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as any)}>
              <option value="ALL">All</option>
              <option value="OPEN">Open/Active</option>
              <option value="CLOSED">Closed</option>
              <option value="REJECT">Rejected/Cancelled</option>
            </select>
          </div>

          <div className="field">
            <label>Show</label>
            <select
              className="small"
              value={limit}
              onChange={(e) => onLimitChange(Number(e.target.value) as Limit)}
            >
              <option value={20}>20</option>
              <option value={50}>50</option>
            </select>
          </div>

          <button className="btn small" type="button" onClick={downloadCsv} title="Download visible rows as CSV">
            CSV
          </button>

          {onClose ? (
            <button className="btn small" type="button" onClick={onClose} title="Close sidebar">
              Close
            </button>
          ) : null}
        </div>
      </div>

      <div className="blotterBody">
        {rows.length ? (
          <table className="blotterTable">
            <thead>
              <tr>
                <th>Time</th>
                <th>Symbol</th>
                <th>Side</th>
                <th>Qty</th>
                <th>Entry</th>
                <th>Exit</th>
                <th>Status</th>
                <th>P&amp;L</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => {
                const tok = Number(t.instrument_token);
                const sym = labelFor(t, tokenLabels);
                const pnl = calcPnl(t);
                const st = t.status || "-";
                const stClass = statusClass(t.status);
                const when = t.updatedAt || t.createdAt;
                const isSel = Number.isFinite(tok) && selectedToken !== null && selectedToken !== undefined && tok === selectedToken;

                return (
                  <tr
                    key={t.tradeId}
                    className={["rowClickable", isSel ? "rowSelected" : ""].join(" ").trim()}
                    onClick={() => {
                      if (Number.isFinite(tok)) onSelectToken?.(tok, t.tradeId);
                    }}
                    title={[
                      `tradeId: ${t.tradeId}`,
                      t.strategyId ? `strategy: ${t.strategyId}` : "",
                      t.closeReason ? `close: ${t.closeReason}` : "",
                      Number.isFinite(Number(t.stopLoss)) ? `SL: ${t.stopLoss}` : "",
                      Number.isFinite(Number(t.targetPrice)) ? `TGT: ${t.targetPrice}` : "",
                    ]
                      .filter(Boolean)
                      .join("\n")}
                  >
                    <td className="mono">{fmtIst(when)}</td>
                    <td className="mono">{sym}</td>
                    <td
                      className={[
                        "mono",
                        (t.side || "").toUpperCase() === "BUY"
                          ? "goodText"
                          : (t.side || "").toUpperCase() === "SELL"
                            ? "badText"
                            : "",
                      ].join(" ")}
                    >
                      {t.side || "-"}
                    </td>
                    <td className="mono">{fmtInt(t.qty)}</td>
                    <td className="mono">{fmtNumber(t.entryPrice)}</td>
                    <td className="mono">{fmtNumber(t.exitPrice)}</td>
                    <td>
                      <span className={["pill", stClass].join(" ")}>{st}</span>
                    </td>
                    <td className="mono">
                      {pnl === null ? "-" : pnl >= 0 ? `+${pnl.toFixed(2)}` : pnl.toFixed(2)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <div className="panelPlaceholder">No trades yet. Waiting for /admin/trades/recent…</div>
        )}
      </div>
    </div>
  );
}
