import { createClient, type SupabaseClient } from '@supabase/supabase-js'

/* ------------------------------------------------------------------ *
 *  Supabase client — accounts + synced designs.
 *
 *  Optional, like the Gemini key and ComfyUI: with no VITE_SUPABASE_*
 *  env the app still builds and runs, `supabase` is null and
 *  `isAuthConfigured` is false. The header then shows a disabled
 *  "accounts not configured" state instead of the sign-in flow.
 *
 *  The anon key is meant to ship in the browser bundle — Row Level
 *  Security (see supabase/schema.sql) is what actually protects data.
 * ------------------------------------------------------------------ */

const url = import.meta.env.VITE_SUPABASE_URL?.trim()
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim()

export const isAuthConfigured = Boolean(url && anonKey)

export const supabase: SupabaseClient | null = isAuthConfigured
  ? createClient(url!, anonKey!, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    })
  : null

/** Row shape of `public.designs`. `brief` / `pinned` fully define a project. */
export type DesignRow = {
  id: string
  user_id: string
  name: string
  brief: unknown
  pinned: string | null
  created_at: string
  updated_at: string
}
