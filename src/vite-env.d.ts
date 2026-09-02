/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Supabase project URL — https://<ref>.supabase.co */
  readonly VITE_SUPABASE_URL?: string
  /** Supabase anon (public) key — safe in the browser, RLS is the boundary */
  readonly VITE_SUPABASE_ANON_KEY?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
