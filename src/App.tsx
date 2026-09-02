import { useEffect } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { SiteHeader } from './components/SiteHeader.tsx'
import { AuthDialog } from './components/AuthDialog.tsx'
import { useAuth } from './state/auth.ts'
import { useDesigns } from './state/designs.ts'

export function App() {
  const { pathname } = useLocation()
  const isWorkspace = pathname.startsWith('/workspace')

  const initAuth = useAuth((s) => s.init)
  const authDialogOpen = useAuth((s) => s.dialogOpen)
  const userId = useAuth((s) => s.user?.id ?? null)
  const fetchDesigns = useDesigns((s) => s.fetch)
  const clearDesigns = useDesigns((s) => s.clearLocal)

  useEffect(() => {
    initAuth()
  }, [initAuth])

  // keep the saved-designs list in sync with who's signed in
  useEffect(() => {
    if (userId) fetchDesigns()
    else clearDesigns()
  }, [userId, fetchDesigns, clearDesigns])

  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader variant={isWorkspace ? 'workspace' : 'marketing'} />
      <main className="flex-1">
        <Outlet />
      </main>
      {authDialogOpen && <AuthDialog />}
    </div>
  )
}
