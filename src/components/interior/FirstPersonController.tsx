/* eslint-disable react/immutability -- This imperative R3F bridge owns camera, canvas and loaded Three object transforms; no React data props are mutated. */
import { useEffect, useLayoutEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Matrix4, Quaternion, Vector3, type Group, type Object3D, type PerspectiveCamera } from 'three'
import type { HouseWalkingSimulation } from '@/lib/walkthrough/navigation.ts'

export type WalkingControls = { enter: () => void; enterDrag: () => void; exit: () => void }
export type WalkingHud = { room: string; floor: number; door: { id: string; open: boolean } | null; blocked: string | null;
  feet: [number, number, number]; grounded: boolean; look: [number, number] }
type Orbit = { enabled: boolean; target: Vector3; update: () => void }

/** One R3F camera and one Rapier world. The orbit viewer and its loaded geometry
 * survive mode changes. Only active walking drives continuous frames.
 */
export function FirstPersonController({ simulation, model, onControls, onActive, onHud, onError }: {
  simulation: HouseWalkingSimulation; model: Group; onControls: (controls: WalkingControls | null) => void;
  onActive: (active: boolean, mode?: 'locked' | 'drag') => void; onHud: (hud: WalkingHud) => void; onError: (message: string) => void
}) {
  const { camera, gl, invalidate, get } = useThree(), keys = useRef(new Set<string>())
  const active = useRef(false), yaw = useRef(simulation.spawn.yaw), pitch = useRef(0), clock = useRef(0), callbacks = useRef({ onActive, onHud, onError })
  const inputMode = useRef<'locked' | 'drag' | null>(null), dragging = useRef(false)
  useLayoutEffect(() => { callbacks.current = { onActive, onHud, onError } }, [onActive, onHud, onError])
  const saved = useRef<{ position: Vector3; quaternion: Quaternion; near: number; far: number; fov: number; target?: Vector3 } | null>(null)
  const doorMeshes = useRef(new Map<string, { mesh: Object3D; originalWorld: Matrix4; originalLocal: Matrix4; centre: Vector3; progress: number }>())
  const direction = useRef(new Vector3()), translation = useRef(new Matrix4()), rotation = useRef(new Matrix4()), delta = useRef(new Matrix4()), parentInverse = useRef(new Matrix4())
  useEffect(() => {
    model.updateMatrixWorld(true)
    const found = doorMeshes.current
    for (const id of simulation.doors.keys()) model.traverse(mesh => {
      if (mesh.userData.partIds?.includes(`${id}:leaf`)) {
        mesh.updateMatrixWorld(true)
        const centre = simulation.doors.get(id)!.centre
        found.set(id, { mesh, originalWorld: mesh.matrixWorld.clone(), originalLocal: mesh.matrix.clone(), centre: new Vector3(centre.x, centre.y, centre.z), progress: NaN })
      }
    })
    return () => { for (const item of found.values()) { item.mesh.matrix.copy(item.originalLocal); item.mesh.matrixAutoUpdate = true; item.mesh.matrix.decompose(item.mesh.position, item.mesh.quaternion, item.mesh.scale); item.mesh.visible = true } found.clear() }
  }, [model, simulation])
  const syncDoors = () => {
    for (const [id, item] of doorMeshes.current) {
      const door = simulation.doors.get(id)!
      if (item.progress === door.progress) continue
      item.progress = door.progress
      const pose = simulation.getDoorPose(id)!
      rotation.current.makeRotationY(pose.angle)
      // The source leaf vertices are already global. Conjugate the world-space
      // operation through its actual GLB parent; never assume identity roots.
      delta.current.makeTranslation(pose.centre.x, pose.centre.y, pose.centre.z).multiply(rotation.current)
      translation.current.makeTranslation(-item.centre.x, -item.centre.y, -item.centre.z); delta.current.multiply(translation.current)
      parentInverse.current.copy(item.mesh.parent?.matrixWorld ?? new Matrix4()).invert()
      item.mesh.matrixAutoUpdate = false; item.mesh.matrix.copy(parentInverse.current).multiply(delta.current).multiply(item.originalWorld)
      item.mesh.matrixWorldNeedsUpdate = true; item.mesh.visible = pose.visible
    }
  }
  useEffect(() => {
    const canvas = gl.domElement, doc = canvas.ownerDocument, view = doc.defaultView!, perspective = camera as PerspectiveCamera
    canvas.tabIndex = 0
    const release = () => {
      if (!active.current) return
      active.current = false; keys.current.clear(); simulation.pause()
      inputMode.current = null; dragging.current = false
      const orbit = get().controls as unknown as Orbit | null, previous = saved.current
      if (previous) { camera.position.copy(previous.position); camera.quaternion.copy(previous.quaternion); perspective.near = previous.near; perspective.far = previous.far; perspective.fov = previous.fov; perspective.updateProjectionMatrix(); if (previous.target && orbit) orbit.target.copy(previous.target) }
      if (orbit) { orbit.enabled = true; orbit.update() }
      saved.current = null; callbacks.current.onActive(false); invalidate()
    }
    const start = (mode: 'locked' | 'drag') => {
      const orbit = get().controls as unknown as Orbit | null
      if (!saved.current) saved.current = { position: camera.position.clone(), quaternion: camera.quaternion.clone(), near: perspective.near, far: perspective.far, fov: perspective.fov, target: orbit?.target.clone() }
      if (orbit) orbit.enabled = false
      active.current = true; inputMode.current = mode; keys.current.clear(); simulation.pause()
      perspective.near = .035; perspective.far = 160; perspective.fov = 72; perspective.updateProjectionMatrix()
      camera.position.set(simulation.eye.x, simulation.eye.y, simulation.eye.z); camera.rotation.order = 'YXZ'; camera.rotation.set(pitch.current, yaw.current, 0)
      callbacks.current.onActive(true, mode); invalidate()
    }
    const lockChange = () => { if (doc.pointerLockElement === canvas) start('locked'); else if (inputMode.current === 'locked') release() }
    const enter = () => {
      if (!canvas.requestPointerLock) { callbacks.current.onError('Walking needs a keyboard, mouse and a browser with pointer-lock support.'); return }
      // Called synchronously from the user's button/keyboard gesture.
      const denied = (error: unknown) => {
        console.warn('[walkthrough] Mouse capture request rejected', error instanceof Error ? `${error.name}: ${error.message}` : String(error), { focused: doc.hasFocus(), visibility: doc.visibilityState })
        callbacks.current.onError('Mouse look could not start. Click Walk inside to try again.')
      }
      try { canvas.focus({ preventScroll: true }); const request = canvas.requestPointerLock(); request?.catch(denied) } catch (error) { denied(error) }
    }
    const exit = () => { if (doc.pointerLockElement === canvas) doc.exitPointerLock(); else release() }
    const enterDrag = () => { canvas.focus({ preventScroll: true }); start('drag') }
    const mouse = (event: MouseEvent) => { if (!active.current || inputMode.current === 'drag' && !dragging.current) return; yaw.current -= event.movementX * .002; pitch.current = Math.max(-Math.PI / 2 + .025, Math.min(Math.PI / 2 - .025, pitch.current - event.movementY * .002)); invalidate() }
    const mouseDown = (event: MouseEvent) => { if (active.current && inputMode.current === 'drag' && event.button === 0) dragging.current = true }
    const mouseUp = () => { dragging.current = false }
    const keyDown = (event: KeyboardEvent) => {
      if (!active.current || event.ctrlKey || event.metaKey || event.altKey) return
      if (event.code === 'Escape') { exit(); return }
      if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyE'].includes(event.code)) event.preventDefault()
      if (event.code === 'KeyE' && !event.repeat) {
        camera.getWorldDirection(direction.current)
        const door = simulation.targetDoor(camera.position, direction.current)
        if (door) simulation.toggleDoor(door.id)
      }
      keys.current.add(event.code)
    }
    const keyUp = (event: KeyboardEvent) => keys.current.delete(event.code)
    const blur = () => { keys.current.clear(); simulation.pause(); exit() }
    const visibility = () => { if (doc.hidden) blur() }
    const lockError = () => { release(); callbacks.current.onError('Mouse look could not start. Click Walk inside to try again.') }
    doc.addEventListener('pointerlockchange', lockChange); doc.addEventListener('pointerlockerror', lockError)
    doc.addEventListener('mousemove', mouse); doc.addEventListener('keydown', keyDown); doc.addEventListener('keyup', keyUp)
    canvas.addEventListener('mousedown', mouseDown); doc.addEventListener('mouseup', mouseUp)
    view.addEventListener('blur', blur); doc.addEventListener('visibilitychange', visibility)
    onControls({ enter, enterDrag, exit })
    return () => {
      onControls(null); doc.removeEventListener('pointerlockchange', lockChange); doc.removeEventListener('pointerlockerror', lockError)
      doc.removeEventListener('mousemove', mouse); doc.removeEventListener('keydown', keyDown); doc.removeEventListener('keyup', keyUp)
      canvas.removeEventListener('mousedown', mouseDown); doc.removeEventListener('mouseup', mouseUp)
      view.removeEventListener('blur', blur); doc.removeEventListener('visibilitychange', visibility)
      if (doc.pointerLockElement === canvas) doc.exitPointerLock(); release()
    }
  }, [camera, gl, get, invalidate, simulation, onControls])
  useFrame((_, elapsed) => {
    if (!active.current) return
    const k = keys.current
    simulation.advance({ forward: Number(k.has('KeyW')) - Number(k.has('KeyS')), right: Number(k.has('KeyD')) - Number(k.has('KeyA')), yaw: yaw.current }, elapsed)
    const eye = simulation.eye
    camera.position.set(eye.x, eye.y, eye.z); camera.rotation.set(pitch.current, yaw.current, 0, 'YXZ')
    syncDoors()
    clock.current += elapsed
    if (clock.current >= .12) {
      clock.current = 0; camera.getWorldDirection(direction.current)
      const floor = simulation.metadata.floors.find(f => f.sourceId === simulation.floorId)
      const room = simulation.metadata.rooms.find(r => r.floorId === simulation.floorId && simulation.feet.x * 1000 >= r.rectMm.x && simulation.feet.x * 1000 <= r.rectMm.x + r.rectMm.w && -simulation.feet.z * 1000 >= r.rectMm.y && -simulation.feet.z * 1000 <= r.rectMm.y + r.rectMm.h)
      callbacks.current.onHud({ room: room?.name ?? '', floor: floor?.level ?? 0, door: simulation.targetDoor(camera.position, direction.current), blocked: simulation.blocked,
        feet: [simulation.feet.x, simulation.feet.y, simulation.feet.z], grounded: simulation.grounded, look: [yaw.current, pitch.current] })
    }
    // Demand rendering resumes its idle behaviour immediately on Escape/blur.
    invalidate()
  })
  return null
}
