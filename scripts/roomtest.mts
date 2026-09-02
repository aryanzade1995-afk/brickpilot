import { defaultBrief } from '../src/lib/model/brief.ts'
import { compile } from '../src/lib/model/canonical.ts'
import { generate, STRATEGIES } from '../src/lib/engine/index.ts'
import { buildRoom } from '../src/lib/three/buildRoom.ts'

const chars = ['modernist', 'warm-minimal', 'kerala-contemporary'] as const
let total = 0
let bad = 0

for (const c of chars) {
  for (const st of [0, 1, 2, 3]) {
    for (const s of STRATEGIES) {
      const b = defaultBrief()
      b.levels.storeys = st
      b.style.character = c
      const design = generate(compile(b), s.id)

      for (const floor of design.floors) {
        for (const room of floor.rooms) {
          if (room.outdoor) continue
          total++
          const m = buildRoom(design, floor.level, room.id, c)
          const tag = `${c} G+${st} ${s.id} ${floor.name}/${room.id}`
          if (!m) {
            bad++
            console.log('NULL ', tag)
            continue
          }
          // boxes sane
          const badBox = m.boxes.find(
            (x) =>
              x.size.some((v) => !(v > 0.005) || v > 30) ||
              x.pos.some((v) => Math.abs(v) > 40) ||
              Number.isNaN(x.pos[0] + x.size[0]),
          )
          // every camera pose (primary + the 2nd POV) inside the room footprint
          const poses = m.cameras?.length ? m.cameras : [m.camera]
          const cy = m.camera.position[1]
          const insideX = poses.every((p) => Math.abs(p.position[0]) < m.dims.w / 2 + 0.01)
          const insideZ = poses.every((p) => Math.abs(p.position[2]) < m.dims.d / 2 + 0.01)
          const eye = poses.every((p) => p.position[1] > 1.0 && p.position[1] < m.dims.h)
          const hasShell = m.boxes.some((x) => x.mat === 'slab') && m.boxes.some((x) => x.mat === 'ceil')
          const wallCount = new Set(m.boxes.filter((x) => x.mat === 'wall').map((x) => x.id.split('-')[1])).size

          if (badBox || !insideX || !insideZ || !eye || !hasShell || wallCount < 4) {
            bad++
            console.log(
              'BAD  ',
              tag,
              JSON.stringify({
                badBox: badBox?.id,
                insideX,
                insideZ,
                eye: +cy.toFixed(2),
                hasShell,
                wallCount,
                dims: m.dims,
              }),
            )
          }
        }
      }
    }
  }
}

console.log(`\n${total} rooms tested, ${bad} bad`)
process.exit(bad ? 1 : 0)
