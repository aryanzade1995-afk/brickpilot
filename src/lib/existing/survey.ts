import { z } from 'zod'
import type { AsBuilt } from './asBuilt.ts'
import type { Answers } from './types.ts'
import type { Design, FloorPlan } from '../engine/types.ts'
import { reachability } from '../engine/planner/index.ts'
import { rectUnionBBox, rectUnionArea } from '../geometry.ts'
import { stairRun } from '../engine/planner/elements.ts'
import { normalizeBrief, stairGeometry, GOING } from '../engine/planner/program.ts'

const number = z.number().finite().min(0).max(1000)
const point = z.object({ x: number, y: number })
const positive = z.number().finite().positive().max(1000)
const measuredPoint=z.object({x:z.number().finite().min(0).max(80000),y:z.number().finite().min(0).max(80000)})
export const measuredPlanSchema=z.object({
  heightM:z.number().finite().min(2.7).max(4),stairStartSide:z.enum(['N','S','E','W']).optional(),
  rooms:z.array(z.object({id:z.string().min(1),semanticId:z.string().min(1),name:z.string().min(1),zone:z.enum(['social','private','service','circulation','work','sacred','outdoor']),rect:measuredPoint.extend({w:z.number().positive().max(80000),h:z.number().positive().max(80000)}),area:z.number().finite().positive(),outdoor:z.boolean(),wantsWindow:z.boolean()}).passthrough()).min(1).max(100),
  walls:z.array(z.object({a:measuredPoint,b:measuredPoint,thickness:z.number().finite().positive().max(1000),kind:z.enum(['interior','exterior','parapet'])}).passthrough()).min(1).max(300),
  openings:z.array(z.object({kind:z.enum(['door','window','entry']),at:measuredPoint,orient:z.enum(['h','v']),width:z.number().finite().positive().max(20000)}).passthrough()).min(1).max(200),
})
export const surveySchema = z.object({
  plotOffsetXM: number.nullable().default(null), plotOffsetYM: number.nullable().default(null),
  widthM: positive.nullable(), depthM: positive.nullable(), heightM: positive.nullable(),
  columns: z.array(point.extend({ sizeMm: z.number().min(100).max(1500).nullable() })).max(150),
  footings: z.array(point).max(150),
  beams: z.array(z.object({ a: z.number().int().min(0), b: z.number().int().min(0), widthMm: z.number().min(100).max(1500).nullable() })).max(300),
  walls: z.array(z.object({ a: point, b: point, thicknessMm: z.number().min(50).max(1000).nullable(), kind: z.enum(['exterior','interior']) })).max(300),
  rooms: z.array(z.object({ name: z.string().min(1).max(80), type: z.enum(['living','livingDining','dining','kitchen','bed','bath','study','pooja','utility','corridor','foyer','stair']), stairStartSide:z.enum(['N','S','E','W']).nullable().default(null), x: number, y: number, w: positive, h: positive })).max(100),
  openings: z.array(point.extend({ kind: z.enum(['door','window','entry']), orient: z.enum(['h','v']), widthM: positive.nullable(), headM:positive.nullable().default(null), sillM:number.nullable().default(null), swing:z.union([z.literal(1),z.literal(-1)]).default(1), leaf:z.boolean().default(true), emergencyExit:z.boolean().default(false) })).max(200),
  notes: z.array(z.string().max(500)).max(30),
})
/** Draft coordinates are metres after scaling the reader's 0..1000 drawing coordinates. */
export type Survey = z.infer<typeof surveySchema>
export const emptySurvey = (): Survey => ({plotOffsetXM:null,plotOffsetYM:null, widthM:null,depthM:null,heightM:null,columns:[],footings:[],beams:[],walls:[],rooms:[],openings:[],notes:[] })

/** Standard Indian construction values used wherever the drawing shows no measurement. Every one stays editable. */
export const SURVEY_DEFAULTS = { heightM: 3, exteriorWallMm: 230, interiorWallMm: 115, columnMm: 230, beamMm: 230, doorHeadM: 2.1, windowHeadM: 2.1, windowSillM: 0.9 }
/** The default setbacks the plot is sized from (the same as a new villa's brief): rear (top of the drawing), sides and road. */
export const SURVEY_SETBACKS = { rear: 3.3, left: 1.5, right: 1.5, road: 2.3 } // the brief's 3 / 1.2 / 1.2 / 2 m plus room for the outer walls

type Pt2 = { x: number; y: number }
type Box = { x: number; y: number; w: number; h: number }
const mm = (v: number) => Math.round(v * 1000) / 1000

/** A traced house made consistent: walls follow the room edges, every door sits inside the edge its two rooms share,
 *  every window or entrance inside one room's outer edge, openings never overlap, and each door swings to a side
 *  where it fits (otherwise it is an open doorway). Small tracing errors therefore never block the 2D plan. */
function repairHouse(s: Survey, d: typeof SURVEY_DEFAULTS): Pick<Survey, 'walls' | 'openings'> {
  const rooms = s.rooms
  const W = s.widthM ?? Math.max(...rooms.map((r) => r.x + r.w)), D = s.depthM ?? Math.max(...rooms.map((r) => r.y + r.h))
  // walls: the union of room edges, one wall per straight run
  const runs = new Map<string, [number, number][]>()
  const addRun = (flat: boolean, at: number, lo: number, hi: number) => { const k = (flat ? 'h' : 'v') + mm(at); runs.set(k, [...(runs.get(k) ?? []), [mm(lo), mm(hi)]]) }
  for (const r of rooms) { addRun(true, r.y, r.x, r.x + r.w); addRun(true, r.y + r.h, r.x, r.x + r.w); addRun(false, r.x, r.y, r.y + r.h); addRun(false, r.x + r.w, r.y, r.y + r.h) }
  const walls: Survey['walls'] = []
  for (const [k, spans] of runs) {
    const flat = k[0] === 'h', at = Number(k.slice(1))
    spans.sort((p, q) => p[0] - q[0])
    const merged: [number, number][] = []
    for (const [lo, hi] of spans) { const last = merged.at(-1); if (last && lo <= last[1] + 0.001) last[1] = Math.max(last[1], hi); else merged.push([lo, hi]) }
    const outer = flat ? at < 0.001 || at > D - 0.001 : at < 0.001 || at > W - 0.001
    const traced = s.walls.find((w) => w.thicknessMm !== null && (flat ? w.a.y === w.b.y && Math.abs(w.a.y - at) < 0.05 : w.a.x === w.b.x && Math.abs(w.a.x - at) < 0.05))
    for (const [lo, hi] of merged) walls.push({ a: flat ? { x: lo, y: at } : { x: at, y: lo }, b: flat ? { x: hi, y: at } : { x: at, y: hi },
      kind: outer ? 'exterior' : 'interior', thicknessMm: traced?.thicknessMm ?? (outer ? d.exteriorWallMm : d.interiorWallMm) })
  }
  type O = Survey['openings'][number]
  // where each opening may go: the shared edge of two rooms (doors), or one room's outer edge (windows, entrances)
  const edgeOf = (o: O) => {
    const line = o.orient === 'h' ? o.y : o.x, along = o.orient === 'h' ? o.x : o.y
    const sides = rooms.flatMap((r) => {
      const [lo, hi] = o.orient === 'h' ? [r.x, r.x + r.w] : [r.y, r.y + r.h]
      const edges = o.orient === 'h' ? [r.y, r.y + r.h] : [r.x, r.x + r.w]
      return edges.filter((e) => Math.abs(e - line) < 0.25).map((e) => ({ r, e, lo, hi }))
    })
    const off = (e: { at: number; lo: number; hi: number }) => Math.abs(e.at - line) + Math.max(0, e.lo - along, along - e.hi)
    if (o.kind === 'door') {
      let best: { at: number; lo: number; hi: number } | null = null
      for (const p of sides) for (const q of sides) {
        if (p.r === q.r || Math.abs(p.e - q.e) > 0.001) continue
        const cand = { at: p.e, lo: Math.max(p.lo, q.lo), hi: Math.min(p.hi, q.hi) }
        if (cand.hi - cand.lo >= 0.5 && (!best || off(cand) < off(best))) best = cand
      }
      return best
    }
    const outer = sides.filter((p) => o.orient === 'h' ? p.e < 0.001 || p.e > D - 0.001 : p.e < 0.001 || p.e > W - 0.001).map((p) => ({ at: p.e, lo: p.lo, hi: p.hi }))
    return outer.sort((p, q) => off(p) - off(q))[0] ?? null
  }
  let openings: O[] = []
  for (const o of s.openings) {
    const edge = edgeOf(o)
    if (!edge || o.widthM === null) continue
    const margin = o.kind === 'window' ? 0.15 : 0.05
    const room = edge.hi - edge.lo - 2 * margin
    if (room < (o.kind === 'window' ? 0.45 : 0.6)) continue
    const width = mm(Math.min(o.widthM, room))
    const along = Math.min(Math.max(o.orient === 'h' ? o.x : o.y, edge.lo + margin + width / 2), edge.hi - margin - width / 2)
    openings.push(o.orient === 'h' ? { ...o, widthM: width, x: mm(along), y: edge.at } : { ...o, widthM: width, y: mm(along), x: edge.at })
  }
  // never two openings on one stretch of wall: an entrance beats a door, a hinged door an open gap, a door a window
  const span = (o: O) => { const c = o.orient === 'h' ? o.x : o.y; return [c - o.widthM! / 2, c + o.widthM! / 2] }
  const rank = (o: O) => (o.kind === 'entry' ? 3 : o.kind === 'door' && o.leaf ? 2 : o.kind === 'door' ? 1 : 0) + o.widthM! / 100
  const kept: O[] = []
  for (const o of [...openings].sort((p, q) => rank(q) - rank(p))) {
    const clash = kept.some((k) => k.orient === o.orient && (o.orient === 'h' ? k.y === o.y : k.x === o.x) &&
      Math.min(span(k)[1], span(o)[1]) > Math.max(span(k)[0], span(o)[0]) - 0.1)
    if (!clash) kept.push(o)
  }
  openings = openings.filter((o) => kept.includes(o))
  // door swings: the drawn side when the leaf fits inside a room and misses other leaves, else the other side,
  // else the doorway is left open
  const box = (o: O, side: number): Box => o.orient === 'h' ? { x: o.x - o.widthM! / 2, y: side > 0 ? o.y : o.y - o.widthM!, w: o.widthM!, h: o.widthM! }
    : { x: side > 0 ? o.x : o.x - o.widthM!, y: o.y - o.widthM! / 2, w: o.widthM!, h: o.widthM! }
  const within = (b: Box) => rooms.some((r) => b.x >= r.x - 0.002 && b.y >= r.y - 0.002 && b.x + b.w <= r.x + r.w + 0.002 && b.y + b.h <= r.y + r.h + 0.002)
  const hit = (a: Box, b: Box) => Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > 0.01 && Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > 0.01
  const placed: Box[] = []
  openings = openings.map((o) => {
    if (o.kind === 'window' || !o.leaf) return o
    for (const side of [o.swing, -o.swing] as (1 | -1)[]) {
      const b = box(o, side)
      if (within(b) && !placed.some((p) => hit(p, b))) { placed.push(b); return { ...o, swing: side } }
    }
    return { ...o, leaf: false }
  })
  return { walls, openings }
}

/** Fill every blank construction value with a standard one, and place columns where walls meet when none are drawn,
 *  so a traced plan is complete and valid for the 2D plan. Measured values are never replaced. Coordinates in metres. */
export function withDefaults(s: Survey): Survey {
  const d = SURVEY_DEFAULTS
  // whole millimetres everywhere, and room edges exactly on the wall lines they follow
  let walls: Survey['walls'] = s.walls.map((w) => ({ ...w, a: { x: mm(w.a.x), y: mm(w.a.y) }, b: { x: mm(w.b.x), y: mm(w.b.y) }, thicknessMm: w.thicknessMm ?? (w.kind === 'exterior' ? d.exteriorWallMm : d.interiorWallMm) }))
  const lineX = [...new Set(walls.filter((w) => w.a.x === w.b.x).map((w) => w.a.x))], lineY = [...new Set(walls.filter((w) => w.a.y === w.b.y).map((w) => w.a.y))]
  const onto = (v: number, lines: number[]) => { const near = lines.reduce((p, q) => Math.abs(q - v) < Math.abs(p - v) ? q : p, Infinity); return Math.abs(near - v) < 0.05 ? near : mm(v) }
  const rooms = s.rooms.map((r) => { const x0 = onto(r.x, lineX), y0 = onto(r.y, lineY), x1 = onto(r.x + r.w, lineX), y1 = onto(r.y + r.h, lineY); return { ...r, x: x0, y: y0, w: mm(x1 - x0), h: mm(y1 - y0) } })
  let openings: Survey['openings'] = s.openings.map((o) => ({ ...o, headM: o.headM ?? (o.kind === 'window' ? d.windowHeadM : d.doorHeadM), sillM: o.kind === 'window' ? o.sillM ?? d.windowSillM : o.sillM }))
  if (rooms.length) ({ walls, openings } = repairHouse({ ...s, rooms, walls, openings }, d))
  let columns = s.columns.map((c) => ({ ...c, sizeMm: c.sizeMm ?? d.columnMm }))
  if (!columns.length && !s.footings.length && walls.length) {
    // corners and junctions: every wall end that meets another wall, away from doors and windows
    const onWall = (p: Pt2, w: Survey['walls'][number]) => w.a.y === w.b.y
      ? Math.abs(p.y - w.a.y) < 0.02 && p.x >= Math.min(w.a.x, w.b.x) - 0.02 && p.x <= Math.max(w.a.x, w.b.x) + 0.02
      : Math.abs(p.x - w.a.x) < 0.02 && p.y >= Math.min(w.a.y, w.b.y) - 0.02 && p.y <= Math.max(w.a.y, w.b.y) + 0.02
    const inOpening = (p: Pt2) => openings.some((o) => o.widthM !== null && (o.orient === 'h'
      ? Math.abs(p.y - o.y) < 0.05 && Math.abs(p.x - o.x) < o.widthM / 2 + 0.15 : Math.abs(p.x - o.x) < 0.05 && Math.abs(p.y - o.y) < o.widthM / 2 + 0.15))
    const points: Pt2[] = []
    for (const w of walls) for (const p of [w.a, w.b]) {
      if (walls.filter((v) => v !== w && onWall(p, v)).length && !inOpening(p) && !points.some((q) => Math.hypot(q.x - p.x, q.y - p.y) < 0.6)) points.push(p)
    }
    columns = points.map((p) => ({ x: p.x, y: p.y, sizeMm: d.columnMm }))
  }
  return { ...s, heightM: s.heightM ?? d.heightM, plotOffsetXM: s.plotOffsetXM ?? SURVEY_SETBACKS.left, plotOffsetYM: s.plotOffsetYM ?? SURVEY_SETBACKS.rear,
    walls, rooms, openings, columns, beams: s.beams.map((b) => ({ ...b, widthMm: b.widthMm ?? d.beamMm })) }
}
/** the plot a structure of this size needs with the default setbacks */
export const defaultPlot = (widthM: number, depthM: number) => ({ widthM: +(widthM + SURVEY_SETBACKS.left + SURVEY_SETBACKS.right).toFixed(2), depthM: +(depthM + SURVEY_SETBACKS.rear + SURVEY_SETBACKS.road).toFixed(2) })

export function scaleDrawing(value: unknown, width: number, depth: number): Survey {
  const draft = surveySchema.parse(value)
  if (!(width > 0 && depth > 0 && Number.isFinite(width + depth))) throw new Error('Enter the measured drawing width and depth.')
  const p = (v: {x:number;y:number}) => ({x: v.x * width / 1000, y:v.y * depth / 1000})
  return {...draft,widthM:width,depthM:depth,columns:draft.columns.map(c=>({...c,...p(c)})),footings:draft.footings.map(p),
    walls:draft.walls.map(w=>({...w,a:p(w.a),b:p(w.b)})),rooms:draft.rooms.map(r=>({...r,...p(r),w:r.w*width/1000,h:r.h*depth/1000})),openings:draft.openings.map(o=>({...o,...p(o)}))}
}

export function measuredStructure(value: unknown, answers: Answers, confirmed: boolean): AsBuilt {
  const parsed=surveySchema.safeParse(value)
  if(!parsed.success)throw new Error('Enter valid measurements in: '+parsed.error.issues.slice(0,4).map(i=>i.path.join(' → ')).join(', '))
  const s=parsed.data
  if (!confirmed) throw new Error('Confirm the measurements and the positions before continuing.')
  if (!s.widthM || !s.depthM || !s.heightM) throw new Error('Enter the measured width, depth and floor height.')
  if(s.plotOffsetXM===null||s.plotOffsetYM===null)throw new Error('Enter the drawing origin’s distance from the plot’s left and rear edges.')
  if (s.heightM < 2.7 || s.heightM > 4) throw new Error('Floor height must be between 2.7 and 4 metres for the current planner.')
  if (!Number.isFinite(answers.plotWidthM + answers.plotDepthM) || answers.plotWidthM <= 0 || answers.plotDepthM <= 0) throw new Error('Enter the measured plot dimensions.')
  if (s.widthM+s.plotOffsetXM > answers.plotWidthM || s.depthM+s.plotOffsetYM > answers.plotDepthM) throw new Error('The measured structure does not fit the plot dimensions and its position on the plot.')
  if (s.columns.length + s.footings.length < 2) throw new Error('Enter at least two confirmed columns or footings. Do not invent supports missing from the drawing.')
  const inside = (p:{x:number;y:number}) => p.x>=-1e-6 && p.y>=-1e-6 && p.x<=s.widthM!+1e-6 && p.y<=s.depthM!+1e-6 // float sums like 7.0+2.871
  if ([...s.columns,...s.footings,...s.walls.flatMap(w=>[w.a,w.b]),...s.openings].some(p=>!inside(p)) || s.rooms.some(r=>!inside(r)||!inside({x:r.x+r.w,y:r.y+r.h}))) throw new Error('An element extends beyond the measured drawing. Correct its coordinates.')
  if (s.columns.some(c=>c.sizeMm===null) || s.beams.some(b=>b.widthMm===null) || s.walls.some(w=>w.thicknessMm===null) || s.openings.some(o=>o.widthM===null||o.headM===null||(o.kind==='window'&&o.sillM===null))) throw new Error('Fill in every column size, beam width, wall thickness and opening width/head/sill shown in the tables.')
  const mm = (n:number)=>Math.round(n*1000), p=(v:{x:number;y:number})=>({x:mm(v.x),y:mm(v.y)})
  const columns=s.columns.map((c,i)=>({id:`col-${i+1}`,at:p(c),size:c.sizeMm!}))
  const footings=s.footings.map((f,i)=>({id:`foot-${i+1}`,at:p(f)}))
  if (columns.some((c,i)=>columns.slice(i+1).some(d=>Math.hypot(c.at.x-d.at.x,c.at.y-d.at.y)<Math.max(c.size,d.size)))) throw new Error('Two columns overlap. Check their coordinates and sizes.')
  const beams=s.beams.map((b,i)=>{
    if (!columns[b.a] || !columns[b.b] || b.a===b.b) throw new Error('Each beam must connect two different existing column numbers.')
    return {id:`beam-${i+1}`,a:columns[b.a].at,b:columns[b.b].at,width:b.widthMm!}
  })
  const walls=s.walls.map((w,i)=>{
    if (w.a.x!==w.b.x && w.a.y!==w.b.y) throw new Error('Angled walls need a surveyed drawing; this planner supports horizontal and vertical walls.')
    if(w.a.x===w.b.x && w.a.y===w.b.y) throw new Error('A wall must have two different endpoints.')
    return {id:`wall-${i+1}`,a:p(w.a),b:p(w.b),thickness:w.thicknessMm!}
  })
  const structure: AsBuilt['structure']={columns,footings,beams,walls,storeysBuilt:answers.storeysBuilt,position:{x:mm(s.plotOffsetXM),y:mm(s.plotOffsetYM)}}
  if (s.rooms.length) {
    if(answers.storeysWanted!==1) throw new Error('A traced house plan currently imports one floor. Set floors wanted to 1; additional floors need their own measured plans.')
    if(!walls.length || !s.openings.some(o=>o.kind==='entry')) throw new Error('To preserve a house plan, enter its walls and main entrance. Use Entry for the outside door.')
    if(s.rooms.some(r=>r.type==='stair'&&!r.stairStartSide))throw new Error('Choose the starting side for each existing staircase.')
    const counters:Record<string,number>={}
    const rooms:FloorPlan['rooms']=s.rooms.map(r=>{
      counters[r.type]=(counters[r.type]??0)+1
      const id=['bed','bath','study'].includes(r.type)||counters[r.type]>1?`${r.type}${counters[r.type]}`:r.type
      return {id,semanticId:`GF_${id.toUpperCase()}`,name:r.name,zone:r.type==='bed'?'private':r.type==='bath'||r.type==='kitchen'||r.type==='utility'?'service':r.type==='study'?'work':r.type==='pooja'?'sacred':r.type==='corridor'||r.type==='foyer'||r.type==='stair'?'circulation':'social',rect:{...p(r),w:mm(r.w),h:mm(r.h)},area:r.w*r.h,outdoor:false,wantsWindow:!['bath','corridor','foyer','utility','stair'].includes(r.type)}
    })
    const openings:FloorPlan['openings']=s.openings.map((o,i)=>{
      const at=p(o), width=mm(o.widthM!)
      if(o.headM!>=s.heightM! || (o.kind==='window' && o.sillM!>=o.headM!))throw new Error(`Opening ${i+1} must have its sill below its head and its head below the floor height.`)
      const wall=walls.find(w=>o.orient==='h'?Math.abs(w.a.y-at.y)<2&&Math.abs(w.b.y-at.y)<2&&at.x-width/2>=Math.min(w.a.x,w.b.x)&&at.x+width/2<=Math.max(w.a.x,w.b.x):Math.abs(w.a.x-at.x)<2&&Math.abs(w.b.x-at.x)<2&&at.y-width/2>=Math.min(w.a.y,w.b.y)&&at.y+width/2<=Math.max(w.a.y,w.b.y))
      if(!wall) throw new Error(`Opening ${i+1} must fit on its wall centreline.`)
      const touching=rooms.filter(r=>at.x>=r.rect.x-5&&at.x<=r.rect.x+r.rect.w+5&&at.y>=r.rect.y-5&&at.y<=r.rect.y+r.rect.h+5)
      if(!touching.length)throw new Error(`Opening ${i+1} does not touch a room.`)
      if(o.kind==='door'&&o.leaf){
        const inward={x:at.x+(o.orient==='v'?o.swing*width/2:0),y:at.y+(o.orient==='h'?o.swing*width/2:0)}
        touching.sort((a,b)=>Number(inward.x>b.rect.x&&inward.x<b.rect.x+b.rect.w&&inward.y>b.rect.y&&inward.y<b.rect.y+b.rect.h)-Number(inward.x>a.rect.x&&inward.x<a.rect.x+a.rect.w&&inward.y>a.rect.y&&inward.y<a.rect.y+a.rect.h))
      }
      return {id:`GF_OPENING_${i+1}`,kind:o.kind,orient:o.orient,at,width,rooms:[touching[0].id,o.kind==='entry'||o.kind==='window'?null:touching[1]?.id??null],head:mm(o.headM!),...(o.kind==='window'?{sill:mm(o.sillM!)}:{swing:o.swing,leaf:o.leaf,...(!o.leaf?{treatment:'open' as const}:{})}),...(o.emergencyExit?{emergencyExit:true}:{})}
    })
    structure.measuredPlan={rooms,walls:walls.map((w,i)=>({...w,kind:s.walls[i].kind,heightMm:mm(s.heightM!)})),openings,heightM:s.heightM,stairStartSide:s.rooms.find(r=>r.type==='stair')?.stairStartSide??undefined}
  }
  return {structure,elements:[...columns.map(c=>({kind:'column' as const,...c,state:'LOCKED' as const,confidence:1,confirmed:true})),...footings.map(f=>({kind:'footing' as const,...f,state:'LOCKED' as const,confidence:1,confirmed:true})),...beams.map(b=>({kind:'beam' as const,...b,state:'LOCKED' as const,confidence:1,confirmed:true})),...walls.map(w=>({kind:'wall' as const,...w,state:'LOCKED' as const,confidence:1,confirmed:true}))],needsConfirmation:[],notes:['Measured coordinates confirmed by the user; no snapping or inferred supports.'],size:{w:mm(s.widthM),d:mm(s.depthM)}}
}

/** Reuse the normal Design container but replace all ground geometry with the confirmed tracing. */
export function applyMeasuredPlan(base: Design, structure: AsBuilt['structure']): Design {
  const measured=structure.measuredPlan
  if(!measured)return base
  const dx=structure.position?.x??0,dy=structure.position?.y??0,p=(v:{x:number;y:number})=>({x:v.x+dx,y:v.y+dy})
  const rooms=measured.rooms.map(r=>({...r,rect:{...r.rect,...p(r.rect)}})),openings=measured.openings.map(o=>({...o,at:p(o.at)}))
  const footprint=rooms.map(r=>({...r.rect})), outline=rectUnionBBox(footprint)
  const unreachableRooms=reachability(rooms,openings,0)
  const floor:FloorPlan={level:0,name:'Ground floor',prefix:'GF',outline,footprint,roof:base.floors[0].roof,rooms,walls:measured.walls.map(w=>({...w,a:p(w.a),b:p(w.b)})),openings,columns:structure.columns.map(c=>({...c,at:p(c.at),grid:'measured',state:'LOCKED'})),beams:structure.beams.map(b=>({...b,a:p(b.a),b:p(b.b),span:Math.hypot(b.a.x-b.b.x,b.a.y-b.b.y),state:'LOCKED'})),reachable:unreachableRooms.length===0,unreachableRooms}
  const spaces=rooms.map(r=>{const original=base.model.floors.flatMap(f=>f.spaces).find(s=>s.id===r.id);return {id:r.id,name:r.name,zone:r.zone,target:r.area,min:original?.min??1,max:original?.max??Math.max(r.area,1),wantsWindow:r.wantsWindow,wet:r.zone==='service',outdoor:false,...(original?.role?{role:original.role}:{})}})
  const stairRoom=rooms.find(r=>r.id==='stair')
  if(stairRoom&&measured.stairStartSide){const dimensions=stairGeometry(normalizeBrief(base.model));floor.stair=stairRun(stairRoom.rect,measured.stairStartSide,dimensions.perFlight,GOING)}
  const relationships=openings.filter(o=>o.kind==='door'&&o.rooms?.[0]&&o.rooms?.[1]).map(o=>({a:o.rooms![0]!,b:o.rooms![1]!,kind:'adjacent' as const}))
  const model={...base.model,floors:[{level:0,name:'Ground floor',spaces}],relationships}
  const area=rectUnionArea(footprint)/1e6
  return {...base,id:`${base.id}-measured`,algorithm:'confirmed-measured-plan',userEdited:true,model,floors:[floor],structure:undefined,structuralSizing:undefined,siteFeatures:[],builtAreaSqm:area,footprintSqm:area,coveredFootprintSqm:area,heightM:measured.heightM,coverage:area/(base.model.brief.site.plotWidth*base.model.brief.site.plotDepth),openingCounts:{doors:measured.openings.filter(o=>o.kind!=='window').length,windows:measured.openings.filter(o=>o.kind==='window').length},existingStructure:{structure,dx,dy}}
}
