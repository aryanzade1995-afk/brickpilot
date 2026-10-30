import { Component, Suspense, memo, useEffect, useLayoutEffect, useMemo, type ReactNode } from 'react';
import { ghostWaterArchitecture } from '@/lib/water/ghostScene.ts';
import { Canvas, useThree, type RootState } from '@react-three/fiber';
import { OrbitControls, useGLTF } from '@react-three/drei';
import { Mesh, MeshStandardMaterial, ACESFilmicToneMapping, PCFSoftShadowMap, SRGBColorSpace, type Material } from 'three';
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
export const AcceptedVillaModel = memo(function AcceptedVillaModel({ url, fit = true, style, technicalXray = false, separateRoofTanks = false, gardenShade=false }: {
    url: string;
    fit?: boolean;
    style?: ReferenceGeometry['style'];
    technicalXray?: boolean;
    separateRoofTanks?: boolean;
    gardenShade?: boolean;
}) {
    const gltf = useGLTF(url), anisotropy = useThree(s => s.gl.capabilities.getMaxAnisotropy());
    const { scene, owned } = useMemo(() => {
        const roles = new Map<Material, string>();
        gltf.scene.traverse(o => { if (o instanceof Mesh)
            for (const m of Array.isArray(o.material) ? o.material : [o.material])
                if (o.userData.material_role)
                    roles.set(m, o.userData.material_role); });
        const scene = prepareVillaScene(gltf.scene, anisotropy, separateRoofTanks, gardenShade), owned: Material[] = [], cache = new Map<Material, Material>();
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
    }, [gltf.scene, anisotropy, style, separateRoofTanks, gardenShade]);
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
    return <ModelBoundary><Canvas frameloop="demand" shadows dpr={DPR} gl={GL} camera={CAMERA} onCreated={state=>{state.gl.toneMapping=ACESFilmicToneMapping;state.gl.toneMappingExposure=1;state.gl.outputColorSpace=SRGBColorSpace;state.gl.shadowMap.type=PCFSoftShadowMap;onCreated?.(state)}}>
 <color attach="background" args={['#e8e7e3']}/><hemisphereLight args={['#e5efff','#b4a18b',1.1]}/>
 <directionalLight color="#fff2df" position={[14, 24, -16]} intensity={2.5} castShadow shadow-mapSize={[2048, 2048]} shadow-camera-left={-35} shadow-camera-right={35} shadow-camera-top={35} shadow-camera-bottom={-35} shadow-camera-far={100} shadow-bias={-.0002} shadow-normalBias={.025}/>
 <directionalLight color="#dce8ff" position={[-18,10,12]} intensity={.65}/>
 <Suspense fallback={null}><StudioReflections />{children}</Suspense><OrbitControls makeDefault minPolarAngle={0} maxPolarAngle={Math.PI / 2}/>
 </Canvas></ModelBoundary>;
}
