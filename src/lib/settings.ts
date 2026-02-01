export type AppSettings = {
  baseUrl: string;
  apiKey: string;
  // Kite Connect public API key (safe to expose). Used only to build the login URL.
  kiteApiKey: string;
};

const LS_KEY = "kite_scalper_fe_settings_v1";

function normalizeBaseUrl(u: string) {
  return (u || '').trim().replace(/\/$/, '');
}

export function loadSettings(): AppSettings {
  const defBase =
    import.meta.env.VITE_DEFAULT_BASE_URL || "http://localhost:4001";
  // Never hardcode API keys in source. If you want a default for local dev, set VITE_DEFAULT_API_KEY in `.env.local`.
  const defKey = import.meta.env.VITE_DEFAULT_API_KEY || "";
  const defKiteApiKey = import.meta.env.VITE_KITE_API_KEY || "";

  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw)
      return { baseUrl: normalizeBaseUrl(defBase), apiKey: defKey, kiteApiKey: defKiteApiKey };
    const obj = JSON.parse(raw);
    return {
      baseUrl: normalizeBaseUrl(typeof obj?.baseUrl === "string" ? obj.baseUrl : defBase),
      apiKey: typeof obj?.apiKey === "string" ? obj.apiKey : defKey,
      kiteApiKey:
        typeof obj?.kiteApiKey === "string" ? obj.kiteApiKey : defKiteApiKey,
    };
  } catch {
    return { baseUrl: normalizeBaseUrl(defBase), apiKey: defKey, kiteApiKey: defKiteApiKey };
  }
}

export function saveSettings(s: AppSettings) {
  const next: AppSettings = {
    baseUrl: normalizeBaseUrl(s.baseUrl),
    apiKey: (s.apiKey || '').trim(),
    kiteApiKey: (s.kiteApiKey || '').trim(),
  };
  localStorage.setItem(LS_KEY, JSON.stringify(next));
}
