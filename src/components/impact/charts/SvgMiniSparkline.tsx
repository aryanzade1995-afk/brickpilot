interface SvgMiniSparklineProps {
  data: number[]
  color?: string
}

export function SvgMiniSparkline({ data, color = '#059669' }: SvgMiniSparklineProps) {
  if (!data || data.length < 2) return null

  const min = Math.min(...data)
  const max = Math.max(...data)
  const range = max - min || 1

  const W = 64
  const H = 22
  const step = W / (data.length - 1)

  const points = data.map((d, i) => {
    const x = i * step
    const y = H - 2 - ((d - min) / range) * (H - 4)
    return `${x.toFixed(1)},${y.toFixed(1)}`
  })

  return (
    <svg width={W} height={H} className="overflow-visible select-none shrink-0" aria-hidden="true">
      <path
        d={`M ${points.join(' L ')}`}
        fill="none"
        stroke={color}
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* End Point Dot */}
      <circle
        cx={points[points.length - 1].split(',')[0]}
        cy={points[points.length - 1].split(',')[1]}
        r="2.5"
        fill={color}
      />
    </svg>
  )
}

