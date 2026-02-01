import React from "react";
import { useSettings } from "./lib/settingsContext";
import { useStatus, useSubscriptions, useTradesRecent } from "./lib/hooks";
import { postJson } from "./lib/http";
import { buildKiteLoginUrl, parseKiteRedirect } from "./lib/kiteAuth";
import { ChartPanel, type ChartConfig } from "./components/ChartPanel";
import { useSocketBridge } from "./lib/socket";

function normalizeBaseUrl(u: string) {
  return u.trim().replace(/\/$/, "");
}

const KITE_SESSION_PATH =
  import.meta.env.VITE_KITE_SESSION_PATH || "/admin/kite/session";

export default function App() {
  const { settings, setSettings } = useSettings();
  const [draftBase, setDraftBase] = React.useState(settings.baseUrl);
  const [draftKey, setDraftKey] = React.useState(settings.apiKey);
  const [draftKiteApiKey, setDraftKiteApiKey] = React.useState(
    settings.kiteApiKey,
  );

  const socketState = useSocketBridge();
  const statusQ = useStatus(socketState.connected ? false : 2000);
  const subsQ = useSubscriptions(socketState.connected ? false : 5000);
  const tradesQ = useTradesRecent(80, socketState.connected ? false : 2000);
  const tokens: number[] = subsQ.data?.tokens || [];
  const trades = tradesQ.data?.rows || [];

  const [charts, setCharts] = React.useState<ChartConfig[]>(() => [
    { token: null, intervalMin: 1 },
    { token: null, intervalMin: 1 },
    { token: null, intervalMin: 3 },
    { token: null, intervalMin: 3 },
  ]);

  // Kite login handshake state (optional)
  const [kiteBusy, setKiteBusy] = React.useState(false);
  const [kiteMsg, setKiteMsg] = React.useState<string | null>(null);
  const [kiteErr, setKiteErr] = React.useState<string | null>(null);
  const [kiteRequestToken, setKiteRequestToken] = React.useState<string | null>(
    null,
  );

  // auto-assign tokens to empty charts (first 4 subscribed tokens)
  React.useEffect(() => {
    if (!tokens.length) return;
    setCharts((prev) => {
      const next = [...prev];
      const used = new Set(
        next.map((c) => c.token).filter(Boolean) as number[],
      );
      for (let i = 0; i < next.length; i += 1) {
        if (next[i].token) continue;
        const pick = tokens.find((t) => !used.has(t));
        if (pick) {
          next[i] = { ...next[i], token: pick };
          used.add(pick);
        }
      }
      return next;
    });
  }, [tokens]);

  // If the registered Kite redirect URL points to this FE, Kite will redirect back with `request_token`.
  // We catch it here and hand it to the backend for token exchange (api_secret must stay on server).
  React.useEffect(() => {
    const r = parseKiteRedirect(window.location.search);
    if (!r.ok) return;

    setKiteRequestToken(r.requestToken);
    setKiteBusy(true);
    setKiteMsg(null);
    setKiteErr(null);

    // Clear query params immediately to avoid repeated exchanges on refresh.
    const cleanUrl = `${window.location.origin}${window.location.pathname}${window.location.hash}`;
    window.history.replaceState({}, "", cleanUrl);

    postJson<any>(settings, KITE_SESSION_PATH, {
      request_token: r.requestToken,
    })
      .then((res) => {
        if (res?.ok === false) {
          throw new Error(res?.error || "Kite session exchange failed");
        }
        setKiteMsg("Kite session created on backend");
        setKiteErr(null);
        statusQ.refetch();
      })
      .catch((e: any) => {
        setKiteErr(e?.message || String(e));
        setKiteMsg(null);
      })
      .finally(() => {
        setKiteBusy(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.baseUrl, settings.apiKey]);

  const connected = Boolean(statusQ.data?.ok);
  const halted = Boolean(statusQ.data?.halted || statusQ.data?.killSwitch);
  const hasKiteSession = Boolean(statusQ.data?.ticker?.hasSession);

  const save = () => {
    setSettings({
      baseUrl: normalizeBaseUrl(draftBase),
      apiKey: draftKey.trim(),
      kiteApiKey: draftKiteApiKey.trim(),
    });
  };

  const onKiteLogin = () => {
    const apiKey = (draftKiteApiKey || settings.kiteApiKey).trim();
    if (!apiKey) {
      setKiteErr(
        "Missing Kite API key. Add VITE_KITE_API_KEY in your FE .env or enter it in the top bar and click Save.",
      );
      setKiteMsg(null);
      return;
    }
    const loginUrl = buildKiteLoginUrl(apiKey);
    window.open(loginUrl, "_blank");
  };

  const copyRequestToken = async () => {
    if (!kiteRequestToken) return;
    try {
      await navigator.clipboard.writeText(kiteRequestToken);
      setKiteMsg("Copied request_token to clipboard");
    } catch {
      setKiteMsg("Copy failed (browser blocked clipboard)");
    }
  };

  return (
    <div className="app">
      <div className="topbar">
        <div className="brand">
          <span
            className={[
              "statusDot",
              connected ? (halted ? "bad" : "good") : "",
            ].join(" ")}
          />
          <span>Kite Scalper Dashboard</span>
          <span className="pill">2×2 charts</span>
          <span className="pill">signals → markers (trades)</span>
        </div>

        <div className="controls">
          <div className="field">
            <label>Backend URL</label>
            <input
              value={draftBase}
              onChange={(e) => setDraftBase(e.target.value)}
              placeholder="http://localhost:4001"
            />
          </div>
          <div className="field">
            <label>API key</label>
            <input
              value={draftKey}
              onChange={(e) => setDraftKey(e.target.value)}
              placeholder="x-api-key (optional)"
            />
          </div>
          <div className="field">
            <label>Kite API key</label>
            <input
              className="small"
              value={draftKiteApiKey}
              onChange={(e) => setDraftKiteApiKey(e.target.value)}
              placeholder="kite api_key"
            />
          </div>

          <button className="btn" onClick={save}>
            Save
          </button>

          <span className="pill">
            {connected
              ? halted
                ? "HALTED / KILL"
                : "CONNECTED"
              : "DISCONNECTED"}
          </span>

          <span className={["pill", hasKiteSession ? "good" : "bad"].join(" ")}>
            {hasKiteSession ? "KITE: LOGGED IN" : "KITE: LOGIN REQUIRED"}
          </span>

          <span
            className={[
              "pill",
              socketState.connected ? "good" : "bad",
            ].join(" ")}
            title={
              socketState.lastEvent
                ? `Last socket event: ${socketState.lastEvent}`
                : "Socket events pending"
            }
          >
            {socketState.connected ? "WS: CONNECTED" : "WS: OFFLINE"}
          </span>

          <button
            className="btn"
            onClick={onKiteLogin}
            disabled={kiteBusy}
            title="Opens the official Kite Connect login page"
          >
            {kiteBusy
              ? "Kite…"
              : hasKiteSession
                ? "Re-login Kite"
                : "Login Kite"}
          </button>

          {kiteRequestToken ? (
            <button
              className="btn"
              onClick={copyRequestToken}
              disabled={kiteBusy}
              title="Copy request_token (only if redirect_url points to FE)"
            >
              Copy request_token
            </button>
          ) : null}

          {kiteErr ? <span className="pill bad">{kiteErr}</span> : null}
          {!kiteErr && kiteMsg ? (
            <span className="pill good">{kiteMsg}</span>
          ) : null}
        </div>
      </div>

      <div className="grid">
        {charts.map((cfg, i) => (
          <ChartPanel
            key={i}
            index={i}
            config={cfg}
            tokens={tokens}
            trades={trades}
            tradesLoading={tradesQ.isFetching}
            socketConnected={socketState.connected}
            onChange={(next) =>
              setCharts((prev) => {
                const cp = [...prev];
                cp[i] = next;
                return cp;
              })
            }
          />
        ))}
      </div>
    </div>
  );
}
