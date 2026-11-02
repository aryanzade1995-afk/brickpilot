import {z} from 'zod'
import {createHash} from 'node:crypto'
import {rankLocalCandidates} from './room-ai-service.mjs'
import {ROOM_ANALYSIS_MODEL} from './room-ai-models.mjs'

const schema=z.object({query:z.string().max(700),options:z.array(z.object({id:z.string().max(160),candidates:z.array(z.object({id:z.string().max(50),label:z.string().max(120),score:z.number().finite().min(0).max(1),reason:z.string().max(500),tradeoff:z.string().max(300)})).min(1).max(6)})).min(1).max(4)})
const cache=new Map(),pending=new Map()
export async function directionAdvice(input,rank=rankLocalCandidates){
 const parsed=schema.parse(input),key=createHash('sha256').update(JSON.stringify(parsed)).digest('hex')
 if(cache.has(key))return cache.get(key)
 if(pending.has(key))return pending.get(key)
 const task=(async()=>{
  const candidates=parsed.options.flatMap(option=>option.candidates.map(c=>`${c.label}. ${c.reason}`))
  let similarity=candidates.map(()=>0),mode='plan-analysis',timer
  try{
   const result=await Promise.race([rank({query:parsed.query,candidates}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Local model is warming up')),10000)})])
   if(result.similarity?.length!==candidates.length||result.similarity.some(n=>!Number.isFinite(n)))throw Error('Invalid ranking')
   similarity=result.similarity;mode='local-ai'
  }catch{/* Facts remain useful when local inference is unavailable. */}finally{clearTimeout(timer)}
  let offset=0
  const ranked=parsed.options.map(option=>{
   const items=option.candidates.map((c,i)=>({c,rank:c.score*.65+(similarity[offset+i]??0)*.35}))
   offset+=option.candidates.length;return items
  })
  // Balance each option's strengths with a small preference for showing
  // different, evidenced reasons across the four cards.
  let bestScore=-Infinity,best=[]
  const choose=(i,items,score,used)=>{
   if(i===ranked.length){if(score>bestScore){bestScore=score;best=items}return}
   for(const item of ranked[i])choose(i+1,[...items,item.c],score+item.rank+(used.has(item.c.id)?0:.16),new Set([...used,item.c.id]))
  }
  choose(0,[],0,new Set())
  const recommendations=best.map((candidate,i)=>({planId:parsed.options[i].id,...candidate}))
  const result={mode,model:mode==='local-ai'?ROOM_ANALYSIS_MODEL.model:null,recommendations}
  if(mode==='local-ai'){if(cache.size>=64)cache.delete(cache.keys().next().value);cache.set(key,result)}
  return result
 })().finally(()=>pending.delete(key))
 pending.set(key,task);return task
}
export async function handleDirectionAdvice(req,res,readJson){
 if(new URL(req.url,'http://localhost').pathname!=='/api/directions/advice')return false
 res.setHeader('content-type','application/json');res.setHeader('cache-control','no-store')
 if(req.method!=='POST'){res.writeHead(405);res.end(JSON.stringify({error:'Use POST'}));return true}
 try{const result=await directionAdvice(await readJson(req,40000));res.writeHead(200);res.end(JSON.stringify(result))}
 catch{res.writeHead(422);res.end(JSON.stringify({error:'Valid direction evidence is required'}))}
 return true
}
