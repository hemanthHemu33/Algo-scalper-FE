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
  const defKey =
    import.meta.env.VITE_DEFAULT_API_KEY ||
    "8d6f1c3a2b9e4d7f5a1c0e9b3d6f8a2c7e1d4b9f0a3c6e8d";
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
  localStorage.setItem(LS_KEY, JSON.stringify(s));
}
