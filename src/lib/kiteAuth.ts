export type KiteRedirectResult =
  | { ok: true; requestToken: string; status: string }
  | { ok: false; error?: string };

/**
 * Build the official Kite Connect login URL (v3).
 * Docs: https://kite.trade/docs/connect/v3/user/
 */
export function buildKiteLoginUrl(apiKey: string, redirectParams?: Record<string, string>) {
  const base = 'https://kite.zerodha.com/connect/login';
  const qs = new URLSearchParams();
  qs.set('v', '3');
  qs.set('api_key', apiKey);

  // Optional: pass through your own query params back to your registered redirect URL.
  // The value must be a URL-encoded querystring (the docs call this `redirect_params`).
  if (redirectParams && Object.keys(redirectParams).length > 0) {
    const rp = new URLSearchParams(redirectParams).toString();
    qs.set('redirect_params', rp);
  }

  return `${base}?${qs.toString()}`;
}

/**
 * Parse the redirect URL querystring after Kite login.
 * On success, Kite returns `request_token` and usually `status=success`.
 */
export function parseKiteRedirect(search: string): KiteRedirectResult {
  const s = search.startsWith('?') ? search.slice(1) : search;
  const p = new URLSearchParams(s);

  const requestToken = p.get('request_token') || '';
  const status = (p.get('status') || '').toLowerCase();

  // Common error params
  const err = p.get('error') || p.get('error_type') || p.get('message') || '';

  if (requestToken) {
    return { ok: true, requestToken, status: status || 'success' };
  }

  if (status && status !== 'success') {
    return { ok: false, error: err || `Kite login returned status=${status}` };
  }

  return { ok: false };
}
