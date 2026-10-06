// Checks a villa GLB for z-fighting: faces of different parts lying in one plane. Usage:
//   node --experimental-strip-types scripts/check-coplanar.mjs path/to/villa.glb
import { readFile } from 'node:fs/promises'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { separateCoplanar } from '../src/lib/three/separateCoplanar.ts'

/** the GLB without its images: geometry is all this check needs, and Node has no image decoder */
function geometryOnly(buffer) {
  const json = JSON.parse(new TextDecoder().decode(buffer.subarray(20, 20 + buffer.readUInt32LE(12))))
  const binStart = 20 + buffer.readUInt32LE(12)
  const bin = buffer.subarray(binStart + 8, binStart + 8 + buffer.readUInt32LE(binStart))
  delete json.images; delete json.textures; delete json.samplers
  for (const m of json.materials ?? []) {
    for (const k of Object.keys(m)) if (k.endsWith('Texture')) delete m[k]
    if (m.pbrMetallicRoughness) for (const k of Object.keys(m.pbrMetallicRoughness)) if (k.endsWith('Texture')) delete m.pbrMetallicRoughness[k]
    delete m.extensions
  }
  json.extensionsUsed = (json.extensionsUsed ?? []).filter((e) => !/texture/i.test(e))
  json.extensionsRequired = (json.extensionsRequired ?? []).filter((e) => !/texture/i.test(e))
  let text = Buffer.from(JSON.stringify(json))
  text = Buffer.concat([text, Buffer.alloc((4 - (text.length % 4)) % 4, 0x20)])
  const out = Buffer.alloc(12 + 8 + text.length + 8 + bin.length)
  out.writeUInt32LE(0x46546c67, 0); out.writeUInt32LE(2, 4); out.writeUInt32LE(out.length, 8)
  out.writeUInt32LE(text.length, 12); out.writeUInt32LE(0x4e4f534a, 16); text.copy(out, 20)
  out.writeUInt32LE(bin.length, 20 + text.length); out.writeUInt32LE(0x004e4942, 24 + text.length); bin.copy(out, 28 + text.length)
  return out.buffer.slice(out.byteOffset, out.byteOffset + out.length)
}

const file = process.argv[2]
const source = geometryOnly(await readFile(file))
const gltf = await new Promise((resolve, reject) => new GLTFLoader().parse(source, '', resolve, reject))
const scene = gltf.scene
const t0 = performance.now()
const first = separateCoplanar(scene)
const ms = performance.now() - t0
const again = separateCoplanar(scene)
console.log(`first pass: ${first.meshes} parts stepped back on ${first.planes} shared planes in ${ms.toFixed(0)} ms`)
console.log(`second pass (should be 0): ${again.meshes} parts, ${again.planes} planes`)
if (again.planes) process.exitCode = 1
void THREE
