import { mkdir, writeFile } from 'node:fs/promises'
import { defaultBrief } from '../src/lib/model/brief.ts'
import { compile } from '../src/lib/model/canonical.ts'
import { generate } from '../src/lib/engine/generate.ts'
import { validate } from '../src/lib/rules/index.ts'

// A separate review document mounts production components. It never replaces a saved project.
const folder='output/finishes-review'
await mkdir(folder,{recursive:true})
const brief=defaultBrief(),design=generate(compile(brief)),report=validate(design)
if(!report.hardChecksPass)throw Error('Review fixture must pass all plan checks')
await writeFile(`${folder}/fixture.json`,JSON.stringify({brief,result:{design,report}}))
await writeFile(`${folder}/index.html`, `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Finishes workspace review</title></head><body><div id="root"></div><script type="module" src="./review.tsx"></script></body></html>`)
await writeFile(`${folder}/review.tsx`, `import React,{useState} from 'react'
import {createRoot} from 'react-dom/client'
import {MemoryRouter} from 'react-router-dom'
import {FinishesCostView} from '/src/routes/FinishesCost.tsx'
import {DrawingWorkspace} from '/src/components/DrawingWorkspace.tsx'
import {useFinishes} from '/src/state/finishes.ts'
import '/src/index.css'
import fixture from './fixture.json'
function Review(){
 const [brief,setBrief]=useState(fixture.brief),[view,setView]=useState('cost'),[room,setRoom]=useState('')
 const params=new URLSearchParams(location.search),tab=params.get('tab')||'specifications'
 return <><p className="px-5 py-3 text-xs text-ink-faint">Review fixture · production components · valid fixed plan <button className="ml-3 underline" onClick={()=>setView(view==='cost'?'plan':'cost')}>Show {view==='cost'?'plan':'cost'}</button></p>
 {view==='cost'?<MemoryRouter key={room} initialEntries={['/workspace/finishes?tab='+tab+(room?'&room='+encodeURIComponent(room):'')]}><FinishesCostView result={fixture.result} brief={brief} onBrief={setBrief}/></MemoryRouter>:<div className="p-5"><DrawingWorkspace design={fixture.result.design} highlightCategory="concrete.columns" onRoomClick={id=>{setRoom(id);setView('cost')}}/></div>}</>
}
useFinishes.persist.setOptions({name:'formstead.finishes-review'});
useFinishes.setState({entries:{},lastMeasured:null,quantitiesUpdated:false});
createRoot(document.getElementById('root')).render(<Review/>);
`)
console.log(`${folder}/index.html`)
