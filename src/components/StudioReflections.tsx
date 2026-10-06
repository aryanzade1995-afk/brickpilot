import { Environment, Lightformer } from '@react-three/drei'

/** Local reflection lights: metallic paint and glass work without fetching an HDRI. */
export function StudioReflections() {
  return <Environment resolution={128} frames={1}>
    <Lightformer form="rect" intensity={2.5} position={[0, 14, 0]} rotation={[Math.PI / 2, 0, 0]} scale={[22, 18, 1]} />
    <Lightformer form="rect" intensity={2} position={[-18, 8, -12]} rotation={[0, Math.PI / 2, 0]} scale={[12, 16, 1]} />
    <Lightformer form="rect" intensity={1.5} position={[18, 6, 10]} rotation={[0, -Math.PI / 2, 0]} scale={[18, 10, 1]} />
  </Environment>
}
