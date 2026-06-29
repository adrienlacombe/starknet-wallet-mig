/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL of the token-discovery Worker (Cloudflare). Optional. */
  readonly VITE_PROXY_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
