import { create } from 'zustand'
import type { Session, User } from '@supabase/supabase-js'
import { supabase, isAuthConfigured } from '@/lib/supabase.ts'

/* ------------------------------------------------------------------ *
 *  Auth state — thin wrapper over supabase.auth. supabase-js owns
 *  session persistence (localStorage) and token refresh; this store
 *  just mirrors it for React and drives the sign-in modal.
 * ------------------------------------------------------------------ */

export type AuthStatus = 'loading' | 'ready'

type AuthState = {
  configured: boolean
  status: AuthStatus
  session: Session | null
  user: User | null
  /** the sign-in / create-account modal */
  dialogOpen: boolean

  init: () => void
  openDialog: () => void
  closeDialog: () => void
  signIn: (email: string, password: string) => Promise<{ error?: string }>
  signUp: (email: string, password: string) => Promise<{ error?: string; needsConfirm?: boolean }>
  signOut: () => Promise<void>
}

let started = false

export const useAuth = create<AuthState>((set) => ({
  configured: isAuthConfigured,
  status: isAuthConfigured ? 'loading' : 'ready',
  session: null,
  user: null,
  dialogOpen: false,

  init: () => {
    if (started || !supabase) {
      if (!supabase) set({ status: 'ready' })
      return
    }
    started = true
    supabase.auth
      .getSession()
      .then(({ data }) => set({ session: data.session, user: data.session?.user ?? null, status: 'ready' }))
      .catch(() => set({ status: 'ready' }))
    supabase.auth.onAuthStateChange((_event, session) => {
      set({ session, user: session?.user ?? null, status: 'ready' })
    })
  },

  openDialog: () => set({ dialogOpen: true }),
  closeDialog: () => set({ dialogOpen: false }),

  signIn: async (email, password) => {
    if (!supabase) return { error: 'Accounts are not configured.' }
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
    if (error) return { error: error.message }
    set({ dialogOpen: false })
    return {}
  },

  signUp: async (email, password) => {
    if (!supabase) return { error: 'Accounts are not configured.' }
    const { data, error } = await supabase.auth.signUp({ email: email.trim(), password })
    if (error) return { error: error.message }
    // email confirmation ON → a user row exists but no session yet
    const needsConfirm = !data.session
    if (!needsConfirm) set({ dialogOpen: false })
    return { needsConfirm }
  },

  signOut: async () => {
    await supabase?.auth.signOut()
    set({ session: null, user: null })
  },
}))
