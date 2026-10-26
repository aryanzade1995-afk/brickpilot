/** Real server + Blender integration check. No mocked provider or export files. */
import assert from 'node:assert/strict'
import {readFile,writeFile,mkdir} from 'node:fs/promises'
import {resolve} from 'node:path'
import jpeg from 'jpeg-js'
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js'
import {Box3,Mesh,Vector3} from 'three'
import {createBuildingModel} from '../src/lib/engine/buildingModel.ts'
import {referenceSpec,referenceSettings} from './fixtures/reference-facade.mjs'
import {reconstructFacade,referenceToThree} from '../src/lib/reference/reconstruct.ts'
const planPath=process.argv[2],study=process.argv.includes('--study'),acceptedUrl=process.argv[3]?.startsWith('/api/')&&!study?process.argv[3]:undefined,base=process.env.FORMSTEAD_URL??'http://localhost:8787'
if(!planPath)throw new Error('Usage: node --experimental-strip-types scripts/check-reference-export.mjs <villa request.json> [accepted GLB API URL]')
const input=JSON.parse(await readFile(planPath,'utf8')),design=input.plan??input.design??input,building=createBuildingModel(design)
const output=resolve(study?'outputs/reference-validation-study':'outputs/reference-validation');await mkdir(output,{recursive:true})
// Clearly synthetic facade: coloured rectangular masses for upload/crop testing.
const w=800,h=400,pixels=Buffer.alloc(w*h*4,255)
function rect(x,y,width,height,color){for(let j=y;j<y+height;j++)for(let i=x;i<x+width;i++)pixels.set([...color,255],(j*w+i)*4)}
rect(40,40,720,320,[224,215,196]);rect(80,95,180,220,[71,86,83]);rect(340,95,180,220,[71,86,83]);rect(600,95,100,220,[123,86,60]);rect(80,15,160,20,[128,91,62])
const jpegBytes=jpeg.encode({width:w,height:h,data:pixels},90).data;await writeFile(resolve(output,'synthetic-facade.jpg'),jpegBytes)
async function request(path,body){const r=await fetch(base+path,body===undefined?{}:{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}),v=await r.json();assert.ok(r.ok,JSON.stringify(v));return v}
console.log('Vision health:',await request('/api/reference/health'))
const image=await request('/api/reference/images',{imageBase64:jpegBytes.toString('base64'),mimeType:'image/jpeg'}),spec=referenceSpec(image.id),settings=referenceSettings();spec.source.mimeType='image/jpeg';spec.source.provider='authored-export-validation';spec.envelope.floorCount=building.floors.length
spec.features[0].type='frame';spec.features[0].rect={u:.1,v:.01,w:.2,h:.025};spec.features[0].thicknessRatio=.005
if(study){settings.mode='reference-led';spec.volumes=[{id:'main',type:'main',parentId:null,rect:{u:.05,v:.05,w:.9,h:.9},depthRatio:.2,frontOffsetRatio:0,confidence:.7,evidence:'manual',materialId:'plaster'}];spec.openings=[{id:'study_window',type:'window',hostId:'main',rect:{u:.3,v:.3,w:.2,h:.2},depthRatio:null,confidence:.8,evidence:'manual',materialId:null}];spec.features[0].rect={u:.2,v:.1,w:.6,h:.04};spec.features[0].hostId='main';spec.features[0].type='pergola'}
let geometry=reconstructFacade(building,spec,settings);assert.notEqual(geometry.status,'rejected',JSON.stringify(geometry.issues))
async function job(payload){let j=await request('/api/reference/jobs',payload);while(['queued','running'].includes(j.status)){await new Promise(r=>setTimeout(r,2000));j=await request('/api/reference/jobs/'+j.id);console.log(j.kind,j.stage)}assert.equal(j.status,'ready',j.error);return j}
const reconstruction=await job({kind:'reconstruct',design,spec,settings});assert.equal(reconstruction.result.geometry.signature,geometry.signature)
const exportJob=await job({kind:'export',design,spec,settings,quality:'preview',...(acceptedUrl?{acceptedUrl}:{})});const manifest=exportJob.result.manifest;assert.equal(manifest.referenceMeshCount,geometry.parts.length);assert.equal(manifest.sourceAccepted,!!acceptedUrl)
// Three's GLTFLoader really parses the exported model. Image decoding is skipped
// only for this headless geometry check; browser QA checks actual materials.
const bytes=await (await fetch(base+exportJob.result.files.glb)).arrayBuffer(),loader=new GLTFLoader();loader.register(()=>({name:'HEADLESS_TEXTURE_CHECK',loadTexture:()=>Promise.resolve(null)}));const gltf=await loader.parseAsync(bytes,'')
gltf.scene.updateMatrixWorld(true);let checked=0
gltf.scene.traverse(obj=>{if(!(obj instanceof Mesh)||!obj.userData.reference_part_id)return;const part=geometry.parts.find(p=>p.id===obj.userData.reference_part_id);assert.ok(part);const box=new Box3().setFromObject(obj),center=box.getCenter(new Vector3()).toArray(),expected=referenceToThree(part.positionMm),size=box.getSize(new Vector3()).toArray(),dimensions=[part.sizeMm[0]/1000,part.sizeMm[2]/1000,part.sizeMm[1]/1000];for(let k=0;k<3;k++){assert.ok(Math.abs(center[k]-expected[k])<.002,part.id+' coordinate');assert.ok(Math.abs(size[k]-dimensions[k])<.002,part.id+' dimensions')}checked++})
assert.equal(checked,geometry.parts.length);assert.equal(new Set(manifest.parts.map(p=>p.id)).size,checked)
for(const [ext,url]of Object.entries(exportJob.result.files)){const r=await fetch(base+url);assert.ok(r.ok);const bytes=Buffer.from(await r.arrayBuffer());await writeFile(resolve(output,'verified-facade.'+ext),bytes);assert.ok(bytes.length>100)}
await writeFile(resolve(output,'integration-result.json'),JSON.stringify({exportJob:exportJob.id,signature:geometry.signature,checked,files:exportJob.result.files,sourcePlanId:building.planId},null,2))
console.log('Verified actual Blender .blend / .glb / .png / manifest; Three.js loaded',checked,'facade parts with matching dimensions, coordinates and stable IDs.')
