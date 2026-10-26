/* eslint-disable react/immutability -- This bridge owns the Three scene environment and light target. */
import { useEffect, useMemo } from 'react'
import { useThree } from '@react-three/fiber'
import { Box3, Object3D, PMREMGenerator, Vector3, type Group } from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'

/** Local image-based reflections; no remote HDR download or extra canvas.
 * One bounded shadow map keeps the scene practical on laptop GPUs. */
export function WalkthroughLighting({ model, bounds: framing }: { model: Group; bounds?: Box3 }) {
  const { gl, scene, invalidate } = useThree()
  const placement = useMemo(() => {
    model.updateMatrixWorld(true)
    const bounds = framing ?? new Box3().setFromObject(model), centre = bounds.getCenter(new Vector3()), size = bounds.getSize(new Vector3())
    const target = new Object3D(); target.position.copy(centre)
    const distance=Math.max(20,size.length())
    // Same world sun vector as the Cycles bake (Blender Z-up -> Three Y-up).
    return { target, position: [centre.x-distance*.612, centre.y+distance*.742, centre.z+distance*.272] as [number, number, number],
      span: Math.max(size.x, size.z) * .65, far: size.length() + 45 }
  }, [model, framing])
  useEffect(() => {
    const previous = scene.environment, intensity = scene.environmentIntensity
    const studio = new RoomEnvironment(), generator = new PMREMGenerator(gl), environment = generator.fromScene(studio, .04)
    scene.environment = environment.texture; scene.environmentIntensity = .65
    studio.dispose(); generator.dispose(); gl.shadowMap.needsUpdate = true; invalidate()
    return () => { scene.environment = previous; scene.environmentIntensity = intensity; environment.dispose() }
  }, [gl, scene, invalidate])
  return <>
    <primitive object={placement.target} />
    <ambientLight intensity={.22} /><hemisphereLight args={['#e7efff', '#b7a88d', .55]} />
    <directionalLight position={placement.position} target={placement.target} color="#fff3df" intensity={2.2} castShadow
      shadow-mapSize={[2048, 2048]} shadow-camera-left={-placement.span} shadow-camera-right={placement.span}
      shadow-camera-top={placement.span} shadow-camera-bottom={-placement.span} shadow-camera-near={.5} shadow-camera-far={placement.far}
      shadow-bias={-.00015} shadow-normalBias={.018} />
  </>
}
