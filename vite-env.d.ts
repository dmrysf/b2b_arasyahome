/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_B2B_API_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare const __B2B_E2E_LOOPBACK_HOST__: string;
declare const __B2B_VERSION__: string;
