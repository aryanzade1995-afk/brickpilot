import type { UTILITY_SYMBOLS } from '@/lib/utilities/plan.ts'

/** One normalized SVG glyph catalogue, reused on the plan, in the legend and
 * in exported sheets. Coordinates here are screen pixels, not plan units. */
export function UtilitySymbolGlyph({ type, color }: { type: keyof typeof UTILITY_SYMBOLS; color: string }) {
  return <g fill="white" stroke={color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" pointerEvents="none">
    {type === 'supply_inlet' || type === 'hot_supply_inlet' ? <><rect x={-11} y={-8} width={22} height={16} fill={type === 'hot_supply_inlet' ? '#BE5076' : color} /><text x={0} y={3} textAnchor="middle" fontSize={7} fill="white" stroke="none">{type === 'hot_supply_inlet' ? 'HW' : 'CW'}</text></>
      : type === 'isolation_valve' ? <><path d="M-8-5.5L8 5.5V-5.5L-8 5.5Z" fill={color} stroke={color} strokeWidth={1.2} strokeLinejoin="round" /><line x1={-8} y1={-6.5} x2={-8} y2={6.5} stroke={color} strokeWidth={1.6} strokeLinecap="round" /><line x1={8} y1={-6.5} x2={8} y2={6.5} stroke={color} strokeWidth={1.6} strokeLinecap="round" /></>
      : type === 'water_outlet' ? <><path d="M0-7C2.8-3.5 5.5 0 5.5 3.2A5.5 5.5 0 0 1-5.5 3.2C-5.5 0-2.8-3.5 0-7Z" fill="white" stroke={color} strokeWidth={1.5} strokeLinejoin="round" /><circle cx={0} cy={3} r={1.8} fill={color} stroke="none" /></>
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
      : type === 'switch' ? <><circle cx={-3.5} cy={3.5} r={3.6} fill="white" stroke={color} strokeWidth={1.5} /><line x1={-1.5} y1={1.5} x2={6.5} y2={-6.5} stroke={color} strokeWidth={1.8} strokeLinecap="round" /><line x1={6.5} y1={-6.5} x2={10} y2={-3} stroke={color} strokeWidth={1.8} strokeLinecap="round" /></>
        : type === 'socket' ? <><rect x={-8} y={-8} width={16} height={16} rx={3} fill="white" stroke={color} strokeWidth={1.5} /><circle cx={-3} cy={0.5} r={1.5} fill={color} stroke="none" /><circle cx={3} cy={0.5} r={1.5} fill={color} stroke="none" /><circle cx={0} cy={-3.5} r={1.3} fill={color} stroke="none" /></>
          : type === 'light' ? <><circle r={8} fill="white" stroke={color} strokeWidth={1.5} /><circle r={4.2} fill="#FFEBEE" stroke={color} strokeWidth={1.1} /><circle cx={0} cy={0} r={1.6} fill={color} stroke="none" /><line x1={0} y1={-8} x2={0} y2={-5.5} stroke={color} strokeWidth={1.4} strokeLinecap="round" /><line x1={0} y1={8} x2={0} y2={5.5} stroke={color} strokeWidth={1.4} strokeLinecap="round" /><line x1={-8} y1={0} x2={-5.5} y2={0} stroke={color} strokeWidth={1.4} strokeLinecap="round" /><line x1={8} y1={0} x2={5.5} y2={0} stroke={color} strokeWidth={1.4} strokeLinecap="round" /></>
            : type === 'exhaust_fan' ? <><circle r={8} />{[0, 90, 180, 270].map(angle => <path key={angle} d="M0-1C-6-7 3-8 3-3L1 0Z" transform={`rotate(${angle})`} fill={color} strokeWidth={.5} />)}<circle r={1.8} fill="white" /></>
              : type === 'vertical_stack' ? <><circle r={10} /><circle r={5} fill={color} /></>
                : <circle r={5} fill={color} stroke="white" strokeWidth={1} />}
  </g>
}
