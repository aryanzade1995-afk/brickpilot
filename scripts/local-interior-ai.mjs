import {existsSync} from 'node:fs'
import {join} from 'node:path'
import {spawn} from 'node:child_process'
/** Reuse an installed local service; never download models on project startup. */
export async function startLocalInteriorAI(){
 try{const r=await fetch('http://127.0.0.1:8188/system_stats',{signal:AbortSignal.timeout(1500)});if(r.ok)return null}catch{}
 if(process.platform!=='win32')return null
 const home=process.env.COMFYUI_HOME||join(process.env.USERPROFILE||'','ComfyUI_windows_portable')
 const python=join(home,'python_embeded','python.exe'),main=join(home,'ComfyUI','main.py')
 if(!existsSync(python)||!existsSync(main))return null
 return spawn(python,['-s',main,'--windows-standalone-build','--fp8_e4m3fn-unet'],{cwd:home,windowsHide:true,stdio:'ignore'})
}
