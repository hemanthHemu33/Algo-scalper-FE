# Kite Scalper FE Dashboard (React)

A ready-to-run **React** dashboard that shows **4 TradingView-style candlestick charts in a 2×2 grid** and draws **markers** when trades/orders are placed (based on `instrument_token`).

## What you get
- ✅ 2×2 grid (4 charts always visible)
- ✅ Token selector per chart (uses `/admin/subscriptions`)
- ✅ Interval selector (1m / 3m / 5m)
- ✅ Trade markers on chart (BUY/SELL arrows) using `/admin/trades/recent`
- ✅ SL / Target lines for the latest trade on each token

## Important: one backend patch needed
Your backend currently doesn’t expose candles over HTTP and browser calls will hit CORS.

Apply the patch in: `backend_patch/patch_admin_candles_and_cors.diff` to your backend repo:
- Adds `GET /admin/candles/recent?token=...&intervalMin=...&limit=...`
- Adds basic CORS headers (handles OPTIONS preflight)

See `backend_patch/README.md`.

## Run the FE

```bash
cd kite-scalper-fe-dashboard
npm install
npm run dev
```

Open: `http://localhost:5173`

## Configure
Top bar:
- **Backend URL**: `http://localhost:4001` (or your Render URL)
- **API key**: your `ADMIN_API_KEY` (sent as `x-api-key`). Optional in dev if you have no key.

Settings are saved in localStorage.

## Backend endpoints used
- `GET /admin/status`
- `GET /admin/subscriptions`
- `GET /admin/trades/recent?limit=80`
- `GET /admin/candles/recent?token=123&intervalMin=1&limit=320`  ← added by patch

## Notes
- Markers are drawn using trade `createdAt/updatedAt` matched to the nearest candle time.
- If you want exact entry candle time, you can store `entryTs` in your trade doc and the FE can use that.
