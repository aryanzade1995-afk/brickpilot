// Physical passage audit of an accepted Blender model, with current furnishings.
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parseAcceptedVilla, acceptedVillaCollision } from '../src/lib/three/acceptedVillaWalkthrough.ts'
import { createWalkthroughSource } from '../src/lib/walkthrough/source.ts'
import { buildWalkthroughScene } from '../src/lib/walkthrough/scene.ts'
import { prepareWalkthroughGeometry, prepareWalkthroughAppearance, furnitureColliders } from '../src/lib/walkthrough/delivery.ts'
import { validate } from '../src/lib/rules/index.ts'
import { HouseWalkingSimulation, initializeWalkingPhysics } from '../src/lib/walkthrough/navigation.ts'

const dir = process.argv[2]
if (!dir) throw new Error('Supply an accepted villa job directory')
const request = JSON.parse(await readFile(join(dir, 'request.json'), 'utf8')), accepted = JSON.parse(await readFile(join(dir, 'accepted.json'), 'utf8'))
const source = createWalkthroughSource(request.plan, validate(request.plan), { style: 'indian-contemporary', lighting: 'warm', furnitureDensity: 'medium' })
const geometry = prepareWalkthroughGeometry(buildWalkthroughScene(source.building, validate(request.plan)))
const app = prepareWalkthroughAppearance(request.plan, source, geometry)
const bytes = await readFile(join(accepted.directory, accepted.files.find(f => f.endsWith('.glb'))))
const root = await parseAcceptedVilla(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), accepted.planId)
const mesh = acceptedVillaCollision(root, geometry.metadata.openings)
const identity = { designId: accepted.planId, projectId: 'audit', geometryKey: 'accepted', appearanceKey: 'selected' }
const metadata = { ...geometry.metadata, ...identity }, collision = { ...geometry.collision, ...identity }
await initializeWalkingPhysics()
const entrance = metadata.entries.find(e => /MAIN/.test(e.id)), results = []
for (const opening of metadata.openings.filter(o => o.kind !== 'window')) {
  const a = opening.apertureMm, h = opening.orient === 'h', centre = { x: (a.x + a.w / 2) / 1000, z: -(a.y + a.d / 2) / 1000 }
  const offsets = opening.operation === 'sliding' ? [-.25, -.32] : [0, -.2, .2]
  let passed = false, reason = 'No clear supported approach', last
  for (const along of offsets) for (const distance of [1.15, .65]) for (const sign of [-1, 1]) {
    if (passed) continue
    const x = centre.x + (h ? along * a.w / 1000 : sign * distance), z = centre.z + (h ? sign * distance : -along * a.d / 1000)
    let sim
    try {
      sim = new HouseWalkingSimulation({ ...metadata, entries: [{ ...entrance, position: [x, a.z / 1000, z] }] }, collision, accepted.planId, mesh)
      if (!process.argv.includes('--unfurnished')) sim.replaceFurnishing(furnitureColliders(app))
      if (!sim.canStand(sim.feet)) continue
      for (const door of sim.doors.values()) door.target = true
      for (let i = 0; i < 65; i++) sim.step({ forward: 0, right: 0, yaw: 0 })
      const target = h ? { x, z: centre.z - sign * .65 } : { x: centre.x - sign * .65, z }
      for (let i = 0; i < 130; i++) {
        const dx = target.x - sim.feet.x, dz = target.z - sim.feet.z
        if (Math.hypot(dx, dz) < .08) { passed = true; break }
        sim.step({ forward: 1, right: 0, yaw: Math.atan2(-dx, -dz) })
      }
      reason = sim.blocked ?? 'Collision at opening'; last = sim.feet
    } catch (error) { reason = error.message }
    finally { sim?.dispose() }
  }
  results.push({ source: opening.sourceId, operation: opening.operation, passed, ...(!passed ? { reason, position: last, rooms: opening.rooms } : {}) })
}
console.log(JSON.stringify({ passed: results.filter(r => r.passed).length, total: results.length, furnitureParts: app.furniture.length, results }, null, 2))
if (results.some(r => !r.passed)) process.exitCode=1
