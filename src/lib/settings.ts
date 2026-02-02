export type AppSettings = {
  baseUrl: string;
  apiKey: string;
  // Kite Connect public API key (safe to expose). Used only to build the login URL.
  kiteApiKey: string;
};

const LS_KEY = "kite_scalper_fe_settings_v1";

export function loadSettings(): AppSettings {
  const defBase =
    import.meta.env.VITE_DEFAULT_BASE_URL || "http://localhost:4001";
  const defKey = import.meta.env.VITE_DEFAULT_API_KEY || "";
  const defKiteApiKey = import.meta.env.VITE_KITE_API_KEY || "";

  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw)
      return { baseUrl: defBase, apiKey: defKey, kiteApiKey: defKiteApiKey };
    const obj = JSON.parse(raw);
    return {
      baseUrl: typeof obj?.baseUrl === "string" ? obj.baseUrl : defBase,
      apiKey: typeof obj?.apiKey === "string" ? obj.apiKey : defKey,
      kiteApiKey:
        typeof obj?.kiteApiKey === "string" ? obj.kiteApiKey : defKiteApiKey,
    };
  } catch {
    return { baseUrl: defBase, apiKey: defKey, kiteApiKey: defKiteApiKey };
  }
}

export function saveSettings(s: AppSettings) {
  const norm = {
    baseUrl: (s.baseUrl || "").trim().replace(/\/$/, ""),
    apiKey: (s.apiKey || "").trim(),
    kiteApiKey: (s.kiteApiKey || "").trim(),
  };
  localStorage.setItem(LS_KEY, JSON.stringify(norm));
}
