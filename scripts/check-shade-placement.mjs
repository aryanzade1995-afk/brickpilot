import {readFileSync} from 'node:fs'
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js'
import {Texture,Box3} from 'three'
import {shadeAnchors,createShadeOverlay} from '../src/lib/three/shadeVariants.ts'
const loader=new GLTFLoader().register(parser=>{parser.loadTexture=async()=>new Texture();return {name:'headless-texture-placeholder'}})
async function load(path){const b=readFileSync(path);return (await loader.parseAsync(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),'' )).scene}
const source=await load(process.argv[2]),asset=await load('public/exterior-assets/kenney-shades/detail-awning-wide.glb')
console.log(JSON.stringify({anchors:shadeAnchors(source).map(a=>({id:a.id,top:a.top,box:a.box})),asset:new Box3().setFromObject(asset),overlay:new Box3().setFromObject(createShadeOverlay(source,asset,'sage').root)}))
