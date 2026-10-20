/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Set by `npm run build:preview`: the self-contained artifact build. */
  readonly VITE_PREVIEW?: string;
}
