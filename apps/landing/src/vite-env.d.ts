/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SITE_URL?: string
  readonly VITE_GITHUB_URL?: string
  readonly VITE_APP_URL?: string
  readonly VITE_DOCS_URL?: string
  readonly VITE_PRIVACY_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
