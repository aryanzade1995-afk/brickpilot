/** Indian-grouped rupee formatting: 12,34,567 */
const inr = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 })

export const formatINR = (n: number): string => `₹${inr.format(Math.round(n))}`

/** compact lakh/crore form: ₹1.53 Cr, ₹44 L */
export function formatINRShort(n: number): string {
  const abs = Math.abs(n)
  if (abs >= 1e7) return `₹${(n / 1e7).toFixed(2)} Cr`
  if (abs >= 1e5) return `₹${(n / 1e5).toFixed(1)} L`
  return formatINR(n)
}

export const formatSqm = (n: number): string => `${n.toFixed(1)} m²`

export const formatRange = (lo: number, hi: number, f: (n: number) => string): string =>
  `${f(lo)} – ${f(hi)}`
