import type {GuideContext} from './guide.ts'
import {describeRoom} from './roomExperience.ts'
import type {RoomAudioPlayer} from './roomAudio.ts'

export type NarrationClip={bytes:ArrayBuffer;parts:number}
const cache=new Map<string,Promise<NarrationClip>>()
/** Preload and playback share bytes; changing finishes changes the cache key. */
export function requestNarrationClip(context:GuideContext,part=0):Promise<NarrationClip>{
 const key=JSON.stringify([context.planId,context.currentRoomId,describeRoom(context,'mr'),part])
 const previous=cache.get(key);if(previous)return previous
 if(cache.size>=32)cache.delete(cache.keys().next().value!)
 const task=(async()=>{
  const response=await fetch(`/api/walkthrough-room/audio?part=${part}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({context,language:'mr'}),signal:AbortSignal.timeout(45000)})
  const audio=await response.json()
  if(!response.ok||audio.planId!==context.planId||audio.roomId!==context.currentRoomId||!/^\/api\/walkthrough-room\/audio\/[a-f0-9]{64}\.wav$/.test(audio.url))throw Error('Room audio is unavailable')
  if(audio.part!==undefined&&audio.part!==part)throw Error('Wrong narration part')
  const wave=await fetch(audio.url,{signal:AbortSignal.timeout(15000)})
  if(!wave.ok)throw Error('Room audio is unavailable')
  const bytes=await wave.arrayBuffer()
  if(bytes.byteLength<44||bytes.byteLength>5e6)throw Error('Invalid narration audio')
  return {bytes,parts:Number.isInteger(audio.parts)&&audio.parts>0&&audio.parts<24?audio.parts:1}
 })().catch(error=>{if(cache.get(key)===task)cache.delete(key);throw error})
 cache.set(key,task);return task
}

/** Fetch the following clip during speech; room changes cancel playback. */
export async function playNarrationClips(context:GuideContext,player:Pick<RoomAudioPlayer,'play'|'stop'>,signal:AbortSignal,status:(value:'preparing'|'speaking'|'idle')=>void,load=requestNarrationClip){
 let clip=await load(context,0)
 for(let part=0;part<clip.parts;part++){
  if(signal.aborted)return
  const next=part+1<clip.parts?load(context,part+1).then(value=>({value}),error=>({error})):null
  let finish=()=>{}
  const ended=new Promise<void>(resolve=>{finish=resolve})
  const abort=()=>{player.stop();finish()}
  signal.addEventListener('abort',abort,{once:true})
  try{
   if(signal.aborted)return
   const started=await player.play(clip.bytes,finish)
   if(signal.aborted)return
   if(!started)throw Error('Narration playback could not start')
   status('speaking');await ended
  }finally{signal.removeEventListener('abort',abort)}
  if(signal.aborted)return
  if(next){status('preparing');const result=await next;if('error' in result)throw result.error;clip=result.value}
 }
 if(!signal.aborted)status('idle')
}
