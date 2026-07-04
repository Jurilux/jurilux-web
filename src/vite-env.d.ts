/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Version du build, injectée par la CI (git describe). */
  readonly VITE_APP_VERSION?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
