/** Shared by route loading and tab intent: hover/focus fetches the next page's
 * code while the current view remains usable. No models or jobs start here. */
export const workspacePages = {
  '/workspace': () => import('../routes/Brief.tsx'),
  '/workspace/directions': () => import('../routes/Directions.tsx'),
  '/workspace/plan': () => import('../routes/Plan.tsx'),
  '/workspace/massing': () => import('../routes/Massing.tsx'),
  '/workspace/utilities': () => import('../routes/Utilities.tsx'),
  '/workspace/finishes': () => import('../routes/FinishesCost.tsx'),
  '/workspace/interior': () => import('../routes/Interior.tsx'),
  '/workspace/impact': () => import('../routes/SocialImpact.tsx'),
  '/workspace/report': () => import('../routes/Report.tsx'),
  '/workspace/dataset': () => import('../routes/VillaDataset.tsx'),
}

export function preloadWorkspacePage(path: string) {
  const load = workspacePages[path as keyof typeof workspacePages]
  if (load) void load().catch(() => { /* Normal navigation can retry a failed fetch. */ })
}
