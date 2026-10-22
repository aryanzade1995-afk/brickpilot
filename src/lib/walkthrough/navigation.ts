import RAPIER from '@dimforge/rapier3d-compat'
import type { Collider } from './delivery.ts'
import type { WalkthroughGeometryPayload } from './delivery.ts'
import type { SceneOpening } from './sceneTypes.ts'

export const WALKING = Object.freeze({ radius: .22, height: 1.75, eye: 1.62, skin: .008, step: .23, snap: .24,
  speed: 1.65, acceleration: 12, deceleration: 18, gravity: 9.81, fixedStep: 1 / 60, maxFrame: .1 })
export type NavigationMetadata = WalkthroughGeometryPayload['metadata'] & { designId: string; projectId: string; geometryKey: string; appearanceKey: string }
export type NavigationCollision = WalkthroughGeometryPayload['collision'] & { designId: string; projectId: string; geometryKey: string; appearanceKey: string }
export type WalkingInput = { forward: number; right: number; yaw: number }
/** Immutable, world-metre triangles copied from the displayed accepted GLB.
 * Never mix this collider with the reconstructed shell or fitted furniture. */
export type AcceptedMeshCollision = { vertices: Float32Array; indices: Uint32Array }
type V = { x: number; y: number; z: number }
type Door = { id: string; opening: SceneOpening; collider: RAPIER.Collider; centre: V; size: V; pivot: V | null;
  angle: number; target: boolean; progress: number; operation: 'hinged' | 'sliding' | 'unresolved'; visible: boolean }
const qIdentity = { x: 0, y: 0, z: 0, w: 1 }
const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x))
let initializing: Promise<void> | null = null
export const initializeWalkingPhysics = () => initializing ??= RAPIER.init().catch(error => { initializing = null; throw error })

/** Validate identity and explicit coordinate conventions before creating physics.
 * Old review-only packages remain usable; navigation is audited independently.
 */
export function validateNavigationBundle(metadata: NavigationMetadata, collision: NavigationCollision, planId: string) {
  if (metadata.designId !== planId || collision.designId !== planId || metadata.projectId !== collision.projectId ||
    metadata.geometryKey !== collision.geometryKey || metadata.appearanceKey !== collision.appearanceKey || collision.version !== 1 || collision.units !== 'm' ||
    collision.coordinates !== 'metres-x-plan-east-y-up-z-plan-north') throw new Error('Walking data does not match this house. Generate its assets again.')
  if (!Array.isArray(collision.colliders) || collision.colliders.length > 30000 || !Array.isArray(collision.doors) ||
    !Array.isArray(metadata.entries) || !Array.isArray(metadata.floors) || !Array.isArray(metadata.stairs) || !Array.isArray(metadata.openings) || !Array.isArray(metadata.rooms) || !Array.isArray(metadata.issues)) throw new Error('Walking data is incomplete.')
  for (const c of [...collision.colliders, ...collision.doors.map(d => d.collider)]) {
    if (!c.id || !Array.isArray(c.min) || !Array.isArray(c.max) || c.min.length !== 3 || c.max.length !== 3 ||
      ![...c.min, ...c.max].every(Number.isFinite) || !c.max.every((v, i) => v > c.min[i])) throw new Error('Walking collision geometry is invalid.')
  }
  for (const e of metadata.entries) if (!e.id || !e.position?.every(Number.isFinite) || e.position.length !== 3) throw new Error('The entry information is incomplete.')
  for (const f of metadata.floors) if (!Number.isFinite(f.elevationM) || !f.sourceId) throw new Error('Floor levels are incomplete.')
  const finiteRect = (r: { x: number; y: number; w: number; h: number }) => r && [r.x, r.y, r.w, r.h].every(Number.isFinite) && r.w > 0 && r.h > 0
  for (const r of metadata.rooms) if (!r.id || !finiteRect(r.rectMm)) throw new Error('Walking data is incomplete.')
  for (const s of metadata.stairs) if (!finiteRect(s.openingMm) || !finiteRect(s.startLandingMm) || !Array.isArray(s.steps) || !s.steps.length || !Number.isFinite(s.destinationElevationMm) || s.steps.some(t => !finiteRect(t.rectMm) || !Number.isFinite(t.topMm) || !Number.isFinite(t.bottomMm))) throw new Error('Walking data is incomplete.')
  if (metadata.issues.some(i => i.severity === 'error')) throw new Error('The source house needs geometry review before walking.')
}

/** The same controller runs in R3F and deterministic headless WASM tests.
 * Physics uses delivered world-metre boxes, or the exact accepted GLB triangles.
 * No ramps, replacement floors,
 * hidden stair bridges, floor warps or automatic respawns are created.
 */
export class HouseWalkingSimulation {
  readonly world: RAPIER.World
  readonly character: RAPIER.Collider
  readonly controller: RAPIER.KinematicCharacterController
  readonly metadata: NavigationMetadata
  readonly doors = new Map<string, Door>()
  readonly spawn: { position: V; yaw: number; openingId: string }
  grounded = false
  blocked: 'edge' | 'unsupported' | null = null
  feet: V
  velocity = { x: 0, y: 0, z: 0 }
  private accumulator = 0
  private freed = false
  private floor = ''
  private eyeY = 0
  private collidersByHandle = new Map<number, Collider>()

  constructor(metadata: NavigationMetadata, collision: NavigationCollision, planId = metadata.designId, acceptedMesh?: AcceptedMeshCollision) {
    validateNavigationBundle(metadata, collision, planId)
    this.metadata = metadata
    this.world = new RAPIER.World({ x: 0, y: -WALKING.gravity, z: 0 }); this.world.timestep = WALKING.fixedStep
    try {
      if (acceptedMesh) {
        const { vertices, indices } = acceptedMesh
        if (!vertices.length || vertices.length % 3 || indices.length % 3 || indices.length > 6_000_000 ||
          !vertices.every(Number.isFinite) || !indices.every(i => i < vertices.length / 3)) throw new Error('The accepted model has invalid collision triangles.')
        // Rapier builds its own acceleration structure. Source mesh buffers,
        // materials, visibility and transforms are never modified.
        this.world.createCollider(RAPIER.ColliderDesc.trimesh(vertices, indices))
      } else for (const c of collision.colliders) this.addBox(c)
      for (const record of acceptedMesh ? [] : collision.doors) {
        const opening = metadata.openings.find(o => o.id === record.id)
        if (!opening || opening.kind === 'window' || opening.operation === 'open') throw new Error('A door collision record has no matching source door.')
        const c = this.addBox(record.collider), min = record.collider.min, max = record.collider.max
        const centre = { x: (min[0] + max[0]) / 2, y: (min[1] + max[1]) / 2, z: (min[2] + max[2]) / 2 }
        const size = { x: max[0] - min[0], y: max[1] - min[1], z: max[2] - min[2] }, horizontal = opening.orient === 'h'
        const hinge = opening.hinge
        const pivot = hinge ? { ...centre, ...(horizontal ? { x: hinge === 'a' ? min[0] : max[0] } : { z: hinge === 'a' ? max[2] : min[2] }) } : null
        this.doors.set(record.id, { id: record.id, opening, collider: c, centre, size, pivot, angle: 0, target: false, progress: 0,
          operation: opening.operation === 'sliding' ? 'sliding' : pivot && opening.swing ? 'hinged' : 'unresolved', visible: true })
      }
      this.world.step()
      const entrances = metadata.openings.filter(o => o.kind === 'entry' && !o.emergencyExit && !/EMERGENCY/i.test(o.sourceId))
      const main = entrances.filter(o => /MAIN|ENTRANCE/i.test(o.sourceId)), ids = new Set((main.length ? main : entrances).map(o => o.id))
      const candidates = metadata.entries.filter(e => ids.has(e.id))
      const entry = candidates.find(e => this.canStand({ x: e.position[0], y: e.position[1] + WALKING.skin * 2, z: e.position[2] }))
      if (!entry) throw new Error('No clear, supported main-entrance spawn fits the walking character. Review the entry and nearby furniture.')
      this.feet = { x: entry.position[0], y: entry.position[1] + WALKING.skin * 2, z: entry.position[2] }
      const room = metadata.rooms.find(r => r.id === entry.roomId)
      const dx = room ? (room.rectMm.x + room.rectMm.w / 2) / 1000 - this.feet.x : 0
      const dz = room ? -(room.rectMm.y + room.rectMm.h / 2) / 1000 - this.feet.z : -1
      this.spawn = { position: { ...this.feet }, yaw: Math.atan2(-dx, -dz), openingId: entry.id }
      this.character = this.world.createCollider(RAPIER.ColliderDesc.capsule(WALKING.height / 2 - WALKING.radius, WALKING.radius)
        .setTranslation(this.feet.x, this.feet.y + WALKING.height / 2, this.feet.z))
      this.controller = this.world.createCharacterController(WALKING.skin)
      this.controller.setUp({ x: 0, y: 1, z: 0 }); this.controller.setSlideEnabled(true)
      this.controller.setMaxSlopeClimbAngle(Math.PI / 4); this.controller.setMinSlopeSlideAngle(Math.PI * .26)
      this.controller.enableSnapToGround(WALKING.snap); this.controller.setApplyImpulsesToDynamicBodies(false)
      this.eyeY = this.feet.y + WALKING.eye
      for (let i = 0; i < 10; i++) this.step({ forward: 0, right: 0, yaw: this.spawn.yaw })
    } catch (error) { this.world.free(); throw error }
  }

  private addBox(c: Collider) {
    const half = c.max.map((v, i) => (v - c.min[i]) / 2), p = c.max.map((v, i) => (v + c.min[i]) / 2)
    const item = this.world.createCollider(RAPIER.ColliderDesc.cuboid(half[0], half[1], half[2]).setTranslation(p[0], p[1], p[2]))
    this.collidersByHandle.set(item.handle, c); return item
  }
  private shape() { return new RAPIER.Capsule(WALKING.height / 2 - WALKING.radius, WALKING.radius) }
  /** Finish packages replace only fitted-product collision; doors, stairs, body
   * position and architectural colliders remain untouched. Never respawn. */
  replaceFurnishing(colliders: Collider[]) {
    for (const [handle, record] of this.collidersByHandle) if (record.kind === 'furniture-aabb') {
      const item = this.world.getCollider(handle); if (item) this.world.removeCollider(item, true)
      this.collidersByHandle.delete(handle)
    }
    for (const c of colliders) this.addBox(c)
    this.world.step(); this.pause()
    return this.canStand(this.feet)
  }
  canStand(feet: V) {
    let blocked = false
    this.world.intersectionsWithShape({ x: feet.x, y: feet.y + WALKING.height / 2, z: feet.z }, qIdentity, this.shape(), c => {
      if (c.handle !== this.character?.handle) blocked = true; return !blocked
    }, undefined, undefined, this.character)
    return !blocked && this.supported(feet, .08)
  }
  private supported(feet: V, drop = WALKING.snap + .05) {
    // A source/furniture support check. It never creates a floor over a void.
    const ray = new RAPIER.Ray({ x: feet.x, y: feet.y + .04, z: feet.z }, { x: 0, y: -1, z: 0 })
    const hit = this.world.castRay(ray, drop + .04, false, undefined, undefined, this.character, undefined,
      c => this.collidersByHandle.get(c.handle)?.kind !== 'door')
    return !!hit
  }
  private onSourceStair() {
    return this.metadata.stairs.some(s => {
      const a = s.openingMm, b = s.startLandingMm, x = Math.min(a.x, b.x), y = Math.min(a.y, b.y)
      const r = { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y }, pad = WALKING.radius + .1
      return this.feet.x >= r.x / 1000 - pad && this.feet.x <= (r.x + r.w) / 1000 + pad &&
        this.feet.z >= -(r.y + r.h) / 1000 - pad && this.feet.z <= -r.y / 1000 + pad &&
        this.feet.y >= Math.min(...s.steps.map(t => t.bottomMm)) / 1000 - .15 && this.feet.y <= s.destinationElevationMm / 1000 + .15
    })
  }
  step(input: WalkingInput) {
    if (this.freed || this.blocked === 'unsupported') return
    this.updateDoors()
    const dt = WALKING.fixedStep, length = Math.hypot(input.forward, input.right), scale = length > 1 ? 1 / length : 1
    const forward = clamp(input.forward, -1, 1) * scale, right = clamp(input.right, -1, 1) * scale
    const tx = (-Math.sin(input.yaw) * forward + Math.cos(input.yaw) * right) * WALKING.speed
    const tz = (-Math.cos(input.yaw) * forward - Math.sin(input.yaw) * right) * WALKING.speed
    const ease = 1 - Math.exp(-(length ? WALKING.acceleration : WALKING.deceleration) * dt)
    this.velocity.x += (tx - this.velocity.x) * ease; this.velocity.z += (tz - this.velocity.z) * ease
    this.velocity.y = this.grounded ? -.35 : Math.max(-3, this.velocity.y - WALKING.gravity * dt)
    if (this.onSourceStair()) this.controller.enableAutostep(WALKING.step, .06, false); else this.controller.disableAutostep()
    const desired = { x: this.velocity.x * dt, y: this.velocity.y * dt, z: this.velocity.z * dt }
    this.controller.computeColliderMovement(this.character, desired)
    const move = this.controller.computedMovement(), next = { x: this.feet.x + move.x, y: this.feet.y + move.y, z: this.feet.z + move.z }
    this.blocked = null
    // No falling into courtyards, stairwells or unguarded terrace edges. The
    // character stops before unsupported displacement; it is never respawned.
    if (!this.supported(next)) {
      if (this.supported(this.feet)) { next.x = this.feet.x; next.z = this.feet.z; next.y = this.feet.y; this.velocity.x = this.velocity.z = 0; this.blocked = 'edge' }
      else { this.blocked = 'unsupported'; this.pause(); return }
    }
    this.grounded = this.controller.computedGrounded() || this.supported(next, .035)
    if (this.grounded) this.velocity.y = -.35
    this.feet = next
    this.character.setTranslation({ x: next.x, y: next.y + WALKING.height / 2, z: next.z })
    this.world.step()
    this.eyeY = clamp(this.eyeY + (next.y + WALKING.eye - this.eyeY) * (1 - Math.exp(-16 * dt)), next.y + 1.4, next.y + WALKING.eye + .015)
    this.floor = [...this.metadata.floors].sort((a, b) => b.elevationM - a.elevationM).find(f => f.elevationM <= next.y + .08)?.sourceId ?? ''
  }
  advance(input: WalkingInput, seconds: number) {
    this.accumulator += Math.min(Math.max(seconds, 0), WALKING.maxFrame)
    let count = 0
    while (this.accumulator >= WALKING.fixedStep && count++ < 6) { this.step(input); this.accumulator -= WALKING.fixedStep }
  }
  get eye(): V { return { x: this.feet.x, y: this.eyeY, z: this.feet.z } }
  get floorId() { return this.floor }
  pause() { this.velocity = { x: 0, y: 0, z: 0 }; this.accumulator = 0 }

  /** Door transforms are entirely runtime state, never saved as architecture. */
  private doorPose(door: Door, progress: number) {
    const angle = door.operation === 'hinged' ? (door.opening.swing ?? 1) * Math.PI / 2 * progress : 0
    let centre = { ...door.centre }
    if (door.pivot) {
      const dx = door.centre.x - door.pivot.x, dz = door.centre.z - door.pivot.z
      centre = { ...centre, x: door.pivot.x + Math.cos(angle) * dx + Math.sin(angle) * dz, z: door.pivot.z - Math.sin(angle) * dx + Math.cos(angle) * dz }
    }
    if (door.operation === 'sliding') { if (door.opening.orient === 'h') centre.x += door.size.x * progress; else centre.z -= door.size.z * progress }
    return { centre, angle, rotation: { x: 0, y: Math.sin(angle / 2), z: 0, w: Math.cos(angle / 2) } }
  }
  private updateDoors() {
    let changed = false
    for (const door of this.doors.values()) {
      const target = door.target ? 1 : 0
      if (Math.abs(door.progress - target) < 1e-5) continue
      const next = door.operation === 'unresolved' ? target : clamp(door.progress + Math.sign(target - door.progress) * WALKING.fixedStep * 3, 0, 1)
      const pose = this.doorPose(door, next)
      if (!door.target || door.operation !== 'unresolved') {
        let person = false
        this.world.intersectionsWithShape(pose.centre, pose.rotation, new RAPIER.Cuboid(door.size.x / 2, door.size.y / 2, door.size.z / 2), c => {
          if (c.handle === this.character.handle) person = true; return !person
        })
        if (person) continue // Never close onto the capsule or push the camera.
      }
      door.progress = next; door.angle = pose.angle; door.visible = door.operation !== 'unresolved' || next < .5
      door.collider.setEnabled(door.visible); door.collider.setTranslation(pose.centre); door.collider.setRotation(pose.rotation)
      changed = true
    }
    if (changed) this.world.step() // Refresh the broad phase before this frame's character casts.
  }
  toggleDoor(id: string) { const door = this.doors.get(id); if (door) { door.target = !door.target; return true } return false }
  getDoorPose(id: string) { const door = this.doors.get(id); return door ? { ...this.doorPose(door, door.progress), visible: door.visible, open: door.target, operation: door.operation } : null }
  targetDoor(origin: V, direction: V, distance = 2.0): { id: string; open: boolean } | null {
    let best: { id: string; open: boolean; distance: number } | null = null
    for (const door of this.doors.values()) {
      const a = door.opening.apertureMm, horizontal = door.opening.orient === 'h', plane = horizontal ? -(a.y + a.d / 2) / 1000 : (a.x + a.w / 2) / 1000
      const component = horizontal ? direction.z : direction.x
      if (Math.abs(component) < 1e-5) continue
      const t = (plane - (horizontal ? origin.z : origin.x)) / component
      if (t < 0 || t > distance || best && best.distance < t) continue
      const x = origin.x + t * direction.x, y = origin.y + t * direction.y, z = origin.z + t * direction.z
      if (x < a.x / 1000 - .02 || x > (a.x + a.w) / 1000 + .02 || z < -(a.y + a.d) / 1000 - .02 || z > -a.y / 1000 + .02 || y < a.z / 1000 || y > (a.z + a.h) / 1000) continue
      const obstruction = this.world.castRay(new RAPIER.Ray(origin, direction), t - .03, false, undefined, undefined, this.character, undefined, c => c.handle !== door.collider.handle)
      if (!obstruction) best = { id: door.id, open: door.target, distance: t }
    }
    return best && { id: best.id, open: best.open }
  }
  dispose() { if (!this.freed) { this.freed = true; this.world.free() } }
}
