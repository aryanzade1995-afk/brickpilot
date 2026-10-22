import type { UTILITY_SYMBOLS } from '@/lib/utilities/plan.ts'

/** One normalized SVG glyph catalogue, reused on the plan, in the legend and
 * in exported sheets. Coordinates here are screen pixels, not plan units. */
export function UtilitySymbolGlyph({ type, color }: { type: keyof typeof UTILITY_SYMBOLS; color: string }) {
  return <g fill="white" stroke={color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" pointerEvents="none">
    {type === 'supply_inlet' || type === 'hot_supply_inlet' ? <><rect x={-11} y={-8} width={22} height={16} fill={type === 'hot_supply_inlet' ? '#BE5076' : color} /><text x={0} y={3} textAnchor="middle" fontSize={7} fill="white" stroke="none">{type === 'hot_supply_inlet' ? 'HW' : 'CW'}</text></>
      : type === 'isolation_valve' ? <><path d="M-9-6L9 6V-6L-9 6Z" /><path d="M0 0V-10m-4 0h8" /></>
      : type === 'water_outlet' ? <><circle r={6} /><path d="M-3 1V-5H5m-2 0v4m-6 2h6" /></>
      : type === 'detector_coverage' ? <circle r={10} fill={color} fillOpacity={.1} strokeDasharray="3 3" />
      : type === 'uncovered_area' ? <><rect x={-10} y={-10} width={20} height={20} fill="#ffebeb" strokeWidth={.6} /><path d="M-10 0L0-10M-10 8L8-10M-4 10L10-4M4 10L10 4" strokeOpacity={.6} strokeWidth={1} /></>
      : type === 'smoke_detector' || type === 'heat_detector' ? <><circle r={9} /><text x={0} y={3.5} fontSize={10} fontWeight={600} fill={color} stroke="none" textAnchor="middle">{type === 'smoke_detector' ? 'S' : 'H'}</text></>
      : type === 'manual_call_point' ? <><rect x={-8} y={-8} width={16} height={16} /><text x={0} y={3} fontSize={9} fill={color} stroke="none" textAnchor="middle">M</text></>
      : type === 'sounder' ? <><circle r={5} /><path d="M8-5q6 5 0 10m3-14q10 9 0 18" fill="none" /></>
      : type === 'sprinkler' ? <><circle r={8} /><path d="M-5 0h10M0-5v10" /></>
      : type === 'fire_panel' ? <><rect x={-11} y={-8} width={22} height={16} fill={color} /><text x={0} y={3} textAnchor="middle" fontSize={8} fontWeight={700} stroke="none" fill="white">FP</text></>
      : type === 'extinguisher' ? <path d="M0-9L8 7H-8Z" fill={color} />
      : type === 'exit_sign' ? <><rect x={-16} y={-9} width={32} height={18} fill="#258454" stroke="#258454" /><g stroke="white" fill="none" strokeWidth={1.3}><circle cx={-5} cy={-5} r={1} fill="white" /><path d="M-5-2l-3 4-4 3m4-3 6 2 2 3M-5-2l5 2m0 0h12m-4-3 4 3-4 3" /></g></>
      : type === 'evacuation_route' ? <path d="M-12 0H12M6-5l6 5-6 5" stroke="#258454" strokeDasharray="4 2" fill="none" />
      : type === 'flow_arrow' ? <path d="M-11 0H10M5-5l5 5-5 5" fill="none" />
      : type === 'clearance_warning' ? null
      : type === 'db_panel' ? <><rect x={-9} y={-8} width={18} height={16} fill={color} /><text x={0} y={3} textAnchor="middle" fontSize={8} fontWeight={700} stroke="none" fill="white">DB</text></>
      : type === 'switch' ? <><circle r={5} /><path d="M4-3l6-6" /><text x={8} y={9} fontSize={8} fill={color} stroke="none">S</text></>
        : type === 'socket' ? <><circle r={7} /><path d="M-2-3v5m4-5v5" /></>
          : type === 'light' ? <><circle r={7} /><path d="M-4-4l8 8m-8 0 8-8" /></>
            : type === 'exhaust_fan' ? <><circle r={8} />{[0, 90, 180, 270].map(angle => <path key={angle} d="M0-1C-6-7 3-8 3-3L1 0Z" transform={`rotate(${angle})`} fill={color} strokeWidth={.5} />)}<circle r={1.8} fill="white" /></>
              : type === 'vertical_stack' ? <><circle r={10} /><circle r={5} fill={color} /></>
                : <circle r={5} fill={color} stroke="white" strokeWidth={1} />}
  </g>
}
