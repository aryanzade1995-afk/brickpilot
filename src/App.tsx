import { Outlet, useLocation } from 'react-router-dom'
import { SiteHeader } from './components/SiteHeader.tsx'

export function App() {
  const { pathname } = useLocation()
  const isWorkspace = pathname.startsWith('/workspace')

  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader variant={isWorkspace ? 'workspace' : 'marketing'} />
      <main className="flex-1">
        <Outlet />
      </main>
    </div>
  )
}
