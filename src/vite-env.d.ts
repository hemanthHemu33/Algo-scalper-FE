/// <reference types="vite/client" />

declare interface ImportMetaEnv {
  readonly VITE_DEFAULT_BASE_URL?: string;
  readonly VITE_DEFAULT_API_KEY?: string;

  // Kite Connect (public) API key to build login URL.
  readonly VITE_KITE_API_KEY?: string;

  // Backend endpoint that exchanges request_token -> access_token (must be implemented server-side).
  // Default used by this FE: /admin/kite/session
  readonly VITE_KITE_SESSION_PATH?: string;
}

declare interface ImportMeta {
  readonly env: ImportMetaEnv;
}
