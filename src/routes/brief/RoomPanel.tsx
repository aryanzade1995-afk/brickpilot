import { FURNITURE_LIMITS } from '@/lib/furniture/catalogue.ts'
import { lazy, Suspense, useEffect, useState } from 'react'
import { useStudio } from '@/state/studio.ts'
import { briefRooms, type BriefRoom, type RoomSize } from '@/lib/furniture/rooms.ts'
import { canIncreaseBrief, CAPACITY_GUIDANCE } from '@/lib/engine/planner/fit.ts'
const FurniturePreview = lazy(() => import('./FurniturePreview.tsx').then(m => ({ default: m.FurniturePreview })))
function FitBadge({room}:{room:BriefRoom}){return <span className="whitespace-nowrap border border-line px-2 py-0.5 text-[11px]">{room.fit.verdict}</span>}
export function RoomList(){
 const brief=useStudio(s=>s.brief),selected=useStudio(s=>s.selectedRoomId),select=useStudio(s=>s.selectRoom),edit=useStudio(s=>s.edit),rooms=briefRooms(brief)
 return <div className="space-y-2"><p className="label">Selected rooms · furniture fit</p>{rooms.map(r=><div key={r.id} className={`flex items-start gap-2 border p-3 ${selected===r.id?'border-ink bg-bg-inset':'border-line'}`}>
  <button type="button" onClick={()=>select(r.id)} className="min-w-0 flex-1 text-left" aria-label={`Preview ${r.name}`}><span className="block text-sm">{r.name} <span className="text-ink-faint">· {r.floor}</span></span><span className="block text-xs text-ink-dim">{r.width.toFixed(1)} × {r.depth.toFixed(1)} m · {r.fit.reason}</span></button>
  <FitBadge room={r}/><button type="button" aria-label={`Matters most: ${r.name}`} aria-pressed={r.starred} onClick={()=>edit(b=>{b.rooms.starred=r.starred?b.rooms.starred.filter(id=>id!==r.id):[...b.rooms.starred,r.id]})} className="px-1 text-lg">{r.starred?'★':'☆'}</button>
 </div>)}</div>
}
export function RoomPanel(){
 const brief=useStudio(s=>s.brief),selected=useStudio(s=>s.selectedRoomId),select=useStudio(s=>s.selectRoom),edit=useStudio(s=>s.edit)
 const [collapsed,setCollapsed]=useState(()=>typeof window!=='undefined'&&!!window.matchMedia?.('(max-width: 1023px)').matches),[furnished,setFurnished]=useState(true),rooms=briefRooms(brief)
 const index=selected&&rooms.some(r=>r.id===selected)?rooms.findIndex(r=>r.id===selected):Math.max(0,rooms.findIndex(r=>r.kind==='master')),room=rooms[index]
 const chosenId=room?.id
 useEffect(()=>{if(chosenId&&selected!==chosenId)select(chosenId)},[chosenId,selected,select])
 if(!room)return null
 const choose=(size:RoomSize)=>edit(b=>{if(size==='standard')delete b.rooms.sizes[room.id];else b.rooms.sizes[room.id]=size})
 return <aside aria-label="Room furniture preview" className="brief-room-preview z-[5] max-h-[calc(100dvh-var(--brief-rail-height)-32px)] overflow-y-auto border border-line bg-bg p-4">
  <div className="flex items-start justify-between gap-2"><div><p className="label">Room preview</p><h2 className="mt-1 font-display text-xl">{room.name}</h2><p className="text-xs text-ink-dim">{room.size[0].toUpperCase()+room.size.slice(1)} size, {room.width.toFixed(1)} × {room.depth.toFixed(1)} m · {L_HEIGHT} m high</p></div><button type="button" onClick={()=>setCollapsed(v=>!v)} aria-expanded={!collapsed} className="border border-line p-1 text-xs">{collapsed?'Expand':'Collapse'}</button></div>
  <div className="my-3 flex items-center justify-between"><button type="button" aria-label="Previous room" onClick={()=>select(rooms[(index+rooms.length-1)%rooms.length].id)}>←</button><FitBadge room={room}/><button type="button" aria-label="Next room" onClick={()=>select(rooms[(index+1)%rooms.length].id)}>→</button></div>
  <div className={collapsed?'hidden':'space-y-3'}><p role="status" className="text-xs text-ink-dim">{room.fit.reason}</p>
   <Suspense fallback={<p className="py-8 text-xs text-ink-faint">Preparing room preview…</p>}><FurniturePreview room={room} character={brief.style.character} furnished={furnished}/></Suspense>
   <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={furnished} onChange={e=>setFurnished(e.target.checked)}/>Furnished</label>
   <div className="flex flex-wrap gap-1" aria-label="Room size">{(['compact','small','standard','large'] as const).map(size=>{
    const fits=room.size===size||canIncreaseBrief(brief,b=>{if(size==='standard')delete b.rooms.sizes[room.id];else b.rooms.sizes[room.id]=size})
    return <button key={size} type="button" disabled={!fits} title={!fits?CAPACITY_GUIDANCE:undefined} aria-pressed={room.size===size} onClick={()=>choose(size)} className={`border px-2 py-1 text-xs disabled:opacity-35 ${size===room.size?'border-ink bg-bg-inset':'border-line'}`}>{size[0].toUpperCase()+size.slice(1)}</button>
   })}</div>
   <div className="flex flex-wrap gap-1">{room.fit.placed.map(p=><span key={p.id} className="border border-line px-2 py-1 text-[11px]">{p.name}</span>)}{room.fit.dropped.map(p=><span key={p.id} className="border border-line px-2 py-1 text-[11px] text-ink-faint line-through">{p.name}</span>)}</div>
   <p className="text-[11px] text-ink-faint">Indicative layout. Final sizes and doors come from the generated plan.</p>
  </div>
 </aside>
}
const L_HEIGHT=FURNITURE_LIMITS.height
export function FurnitureReview(){
 const brief=useStudio(s=>s.brief),select=useStudio(s=>s.selectRoom),rooms=briefRooms(brief).filter(r=>r.kind!=='other'),counts={Comfortable:0,Tight:0,'Too small':0}
 for(const room of rooms)counts[room.fit.verdict]++
 return <section className="border border-line p-5"><p className="label">Furniture fit</p><p className="mt-2 text-sm">{counts.Comfortable} comfortable, {counts.Tight} tight, {counts['Too small']} too small</p><div className="mt-3 flex flex-wrap gap-2">{rooms.map(r=><button type="button" key={r.id} className="border border-line px-2 py-1 text-xs" onClick={()=>select(r.id)}>{r.name} · {r.fit.verdict}</button>)}</div></section>
}
