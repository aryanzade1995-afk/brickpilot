import { useEffect } from 'react'
import { Outlet, useLocation, useNavigation } from 'react-router-dom'
import { SiteHeader } from './components/SiteHeader.tsx'
import { AuthDialog } from './components/AuthDialog.tsx'
import { useAuth } from './state/auth.ts'
import { useDesigns } from './state/designs.ts'
import { startAutosave } from './state/projects.ts'

export function App() {
  const { pathname } = useLocation()
  const isWorkspace = pathname.startsWith('/workspace')
  // while the next page's code loads, the current page stays and a slim bar shows the move
  const loading = useNavigation().state === 'loading'

  const initAuth = useAuth((s) => s.init)
  const authDialogOpen = useAuth((s) => s.dialogOpen)
  const userId = useAuth((s) => s.user?.id ?? null)
  const fetchDesigns = useDesigns((s) => s.fetch)
  const clearDesigns = useDesigns((s) => s.clearLocal)

  useEffect(() => {
    initAuth()
  }, [initAuth])

  // the open project saves itself after every major change
  useEffect(() => startAutosave(), [])

  // keep the saved-designs list in sync with who's signed in
  useEffect(() => {
    if (userId) fetchDesigns()
    else clearDesigns()
  }, [userId, fetchDesigns, clearDesigns])

  return (
    <div className="flex min-h-dvh flex-col">
      <div aria-hidden className={`pointer-events-none fixed inset-x-0 top-0 z-[60] h-0.5 origin-left bg-accent transition-[transform,opacity] duration-300 ${loading ? 'scale-x-75 opacity-100 ease-out' : 'scale-x-100 opacity-0'}`} />
      <SiteHeader variant={isWorkspace ? 'workspace' : 'marketing'} />
      <main className="flex-1">
        <Outlet />
      </main>
      {authDialogOpen && <AuthDialog />}
    </div>
  )
}
