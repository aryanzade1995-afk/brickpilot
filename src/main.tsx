import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createBrowserRouter, Navigate, RouterProvider } from 'react-router-dom'
import { App } from './App.tsx'
import './index.css'
// each page's code loads when it is first opened (the current page stays on screen meanwhile), so the first visit is fast
const page = <T extends Record<string, unknown>>(load: () => Promise<T>, name: keyof T) => async () => ({ Component: (await load())[name] as React.ComponentType })
const Landing = page(() => import('./routes/Landing.tsx'), 'Landing')
const Start = page(() => import('./routes/Start.tsx'), 'Start')
const ExistingMode = page(() => import('./routes/ExistingMode.tsx'), 'ExistingMode')
const Brief = page(() => import('./routes/Brief.tsx'), 'Brief')
const Directions = page(() => import('./routes/Directions.tsx'), 'Directions')
const Plan = page(() => import('./routes/Plan.tsx'), 'Plan')
const Massing = page(() => import('./routes/Massing.tsx'), 'Massing')
const FinishesCost = page(() => import('./routes/FinishesCost.tsx'), 'FinishesCost')
const VillaDataset = page(() => import('./routes/VillaDataset.tsx'), 'VillaDataset')
const Interior = page(() => import('./routes/Interior.tsx'), 'Interior')
const Report = page(() => import('./routes/Report.tsx'), 'Report')
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
      { path: 'workspace/massing', lazy: Massing },
      { path: 'workspace/render', element: <Navigate to="/workspace/massing" replace /> },
      { path: 'workspace/finishes', lazy: FinishesCost },
      { path: 'workspace/dataset', lazy: VillaDataset },
      { path: 'workspace/interior', lazy: Interior },
      { path: 'workspace/report', lazy: Report },
      { path: 'designs', lazy: Designs },
    ],
  },
  { path: '/share/finishes/:token', lazy: SharedFinishes },
  { path: '/__styles', lazy: StyleSheet },
])

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
)
