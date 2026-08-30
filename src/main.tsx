import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createBrowserRouter, RouterProvider } from 'react-router-dom'
import { App } from './App.tsx'
import './index.css'
import { Landing } from './routes/Landing.tsx'
import { Brief } from './routes/Brief.tsx'
import { Directions } from './routes/Directions.tsx'
import { Plan } from './routes/Plan.tsx'
import { Massing } from './routes/Massing.tsx'

const router = createBrowserRouter([
  {
    path: '/',
    element: <App />,
    children: [
      { index: true, element: <Landing /> },
      { path: 'workspace', element: <Brief /> },
      { path: 'workspace/directions', element: <Directions /> },
      { path: 'workspace/plan', element: <Plan /> },
      { path: 'workspace/massing', element: <Massing /> },
    ],
  },
])

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
)
