import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createBrowserRouter, Navigate, RouterProvider } from 'react-router-dom'
import { App } from './App.tsx'
import './index.css'
import { LanguageDocument } from './components/LanguageDocument.tsx'
import { workspacePages } from './lib/workspacePages.ts'
// each page's code loads when it is first opened (the current page stays on screen meanwhile), so the first visit is fast
const page = <T extends Record<string, unknown>>(load: () => Promise<T>, name: keyof T) => async () => ({ Component: (await load())[name] as React.ComponentType })
const Landing = page(() => import('./routes/Landing.tsx'), 'Landing')
const Start = page(() => import('./routes/Start.tsx'), 'Start')
const ExistingMode = page(() => import('./routes/ExistingMode.tsx'), 'ExistingMode')
const Brief = page(workspacePages['/workspace'], 'Brief')
const Directions = page(workspacePages['/workspace/directions'], 'Directions')
const Plan = page(workspacePages['/workspace/plan'], 'Plan')
const Massing = page(workspacePages['/workspace/massing'], 'Massing')
const Utilities = page(workspacePages['/workspace/utilities'], 'Utilities')
const FinishesCost = page(workspacePages['/workspace/finishes'], 'FinishesCost')
const VillaDataset = page(workspacePages['/workspace/dataset'], 'VillaDataset')
const Interior = page(workspacePages['/workspace/interior'], 'Interior')
const SocialImpact = page(workspacePages['/workspace/impact'], 'SocialImpact')
const Report = page(workspacePages['/workspace/report'], 'Report')
const Designs = page(() => import('./routes/Designs.tsx'), 'Designs')
const SharedFinishes = page(() => import('./routes/SharedFinishes.tsx'), 'SharedFinishes')
const StyleSheet = page(() => import('./routes/StyleSheet.tsx'), 'StyleSheet')

const router = createBrowserRouter([
  {
    path: '/',
    element: <App />,
    hydrateFallbackElement: <div className="min-h-dvh" />,
    children: [
      { index: true, lazy: Landing },
      { path: 'start', lazy: Start },
      { path: 'home', lazy: Start },
      { path: 'workspace/existing', lazy: ExistingMode },
      { path: 'workspace', lazy: Brief },
      { path: 'workspace/directions', lazy: Directions },
      { path: 'workspace/plan', lazy: Plan },
      { path: 'workspace/reference', element: <Navigate to="/workspace/plan#reference-facade" replace /> },
      { path: 'workspace/massing', lazy: Massing },
      { path: 'workspace/utilities', lazy: Utilities },
      { path: 'workspace/render', element: <Navigate to="/workspace/massing" replace /> },
      { path: 'workspace/finishes', lazy: FinishesCost },
      { path: 'workspace/dataset', lazy: VillaDataset },
      { path: 'workspace/interior', lazy: Interior },
      { path: 'workspace/impact', lazy: SocialImpact },
      { path: 'workspace/report', lazy: Report },
      { path: 'designs', lazy: Designs },
    ],
  },
  { path: '/share/finishes/:token', lazy: SharedFinishes },
  { path: '/__styles', lazy: StyleSheet },
])

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <LanguageDocument><RouterProvider router={router} /></LanguageDocument>
  </StrictMode>,
)
