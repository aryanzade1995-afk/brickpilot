import { Navigate } from 'react-router-dom'

/** The former entry cards are removed; existing start links open the brief. */
export function Start() {
  return <Navigate to="/workspace" replace />
}
