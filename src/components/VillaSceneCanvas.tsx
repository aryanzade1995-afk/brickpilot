import { Component, Suspense, memo, useEffect, useLayoutEffect, useMemo, type ReactNode } from 'react';
import { ghostWaterArchitecture } from '@/lib/water/ghostScene.ts';
import { Canvas, useThree, type RootState } from '@react-three/fiber';
import { OrbitControls, useGLTF } from '@react-three/drei';
import { Mesh, MeshStandardMaterial, type Material } from 'three';
import { prepareVillaScene } from '@/lib/three/prepareVillaScene.ts';
import { FitAcceptedVilla } from '@/lib/three/SolarCamera.tsx';
import { StudioReflections } from './StudioReflections.tsx';
import type { ReferenceGeometry } from '@/lib/reference/reconstruct.ts';
const CAMERA = { position: [20, 14, -25] as [
        number,
        number,
        number
    ], fov: 40 }, GL = { antialias: true, logarithmicDepthBuffer: true, preserveDrawingBuffer: true }, DPR: [
    number,
    number
] = [1, 2];
export const AcceptedVillaModel = memo(function AcceptedVillaModel({ url, fit = true, style, technicalXray = false, separateRoofTanks = false }: {
    url: string;
    fit?: boolean;
    style?: ReferenceGeometry['style'];
    technicalXray?: boolean;
    separateRoofTanks?: boolean;
}) {
    const gltf = useGLTF(url), anisotropy = useThree(s => s.gl.capabilities.getMaxAnisotropy());
    const { scene, owned } = useMemo(() => {
        const roles = new Map<Material, string>();
        gltf.scene.traverse(o => { if (o instanceof Mesh)
            for (const m of Array.isArray(o.material) ? o.material : [o.material])
                if (o.userData.material_role)
                    roles.set(m, o.userData.material_role); });
        const scene = prepareVillaScene(gltf.scene, anisotropy, separateRoofTanks), owned: Material[] = [], cache = new Map<Material, Material>();
        if (style)
            scene.traverse(o => { if (!(o instanceof Mesh))
                return; const convert = (m: Material) => { const look = style[roles.get(m) ?? '']; if (!look || !(m instanceof MeshStandardMaterial))
                return m; let v = cache.get(m); if (!v) {
                const copy = m.clone();
                copy.color.set(look.color);
                copy.roughness = look.roughness;
                copy.metalness = look.metallic;
                copy.opacity = look.opacity;
                copy.transparent = look.opacity < 1;
                copy.map = null;
                v = copy;
                cache.set(m, v);
                owned.push(v);
            } return v; }; o.material = Array.isArray(o.material) ? o.material.map(convert) : convert(o.material); });
        return { scene, owned };
    }, [gltf.scene, anisotropy, style, separateRoofTanks]);
    useEffect(() => () => owned.forEach(m => m.dispose()), [owned]);
    const invalidate = useThree(s=>s.invalidate)
    useLayoutEffect(()=>{if(!technicalXray){invalidate();return}const restore=ghostWaterArchitecture(scene);invalidate();return()=>{restore();invalidate()}},[scene,technicalXray,invalidate]);
    return <><primitive object={scene} dispose={null}/>{fit && <FitAcceptedVilla scene={scene}/>}</>;
});
class ModelBoundary extends Component<{
    children: ReactNode;
}, {
    failed: boolean;
}> {
    state = { failed: false };
    static getDerivedStateFromError() { return { failed: true }; }
    render() { return this.state.failed ? <p role="alert" className="p-6 text-sm text-ink-dim">The 3D model could not load. Your original design and downloads are retained.</p> : this.props.children; }
}
/** Shared villa canvas for existing Massing and Reference Reconstruction. */
export function VillaSceneCanvas({ children, onCreated }: {
    children: ReactNode;
    onCreated?: (state: RootState) => void;
}) {
    return <ModelBoundary><Canvas frameloop="demand" shadows dpr={DPR} gl={GL} camera={CAMERA} onCreated={onCreated}>
 <color attach="background" args={['#e5e5e5']}/><ambientLight intensity={.6}/>
 <directionalLight position={[20, 30, -10]} intensity={2} castShadow shadow-mapSize={[2048, 2048]} shadow-camera-left={-35} shadow-camera-right={35} shadow-camera-top={35} shadow-camera-bottom={-35} shadow-camera-far={100} shadow-bias={-.0005} shadow-normalBias={.05}/>
 <Suspense fallback={null}><StudioReflections />{children}</Suspense><OrbitControls makeDefault minPolarAngle={0} maxPolarAngle={Math.PI / 2}/>
 </Canvas></ModelBoundary>;
}
