import { useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import { PerspectiveCamera, Vector3 } from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import type { ReferenceGeometry } from '@/lib/reference/reconstruct.ts';
import { referenceToThree } from '@/lib/reference/reconstruct.ts';
import { alignedCamera } from '@/lib/reference/comparison.ts';
import type { ReferenceSettings } from '@/lib/reference/schema.ts';
export function ReferenceLayer({ geometry, selected, onSelect }: {
    geometry: ReferenceGeometry;
    selected?: string | null;
    onSelect?: (id: string) => void;
}) {
    return <group name={'ReferenceFacade_' + geometry.signature} userData={{ reference_signature: geometry.signature, sourcePlanId: geometry.sourcePlanId }}>
 {geometry.parts.map(part => <mesh key={part.id} name={part.id} position={referenceToThree(part.positionMm)} castShadow receiveShadow userData={{ referencePartId: part.id, referenceComponentId: part.ownerId, referenceImage: part.sourceImage, confidence: part.confidence }} onClick={e => { e.stopPropagation(); onSelect?.(part.ownerId); }}>
 <boxGeometry args={[part.sizeMm[0] / 1000, part.sizeMm[2] / 1000, part.sizeMm[1] / 1000]}/><meshStandardMaterial color={part.material.color} roughness={part.material.roughness} metalness={part.material.metallic} transparent={part.material.opacity < 1} opacity={part.material.opacity} emissive={selected === part.ownerId ? '#446755' : '#000000'} emissiveIntensity={selected === part.ownerId ? .25 : 0}/>
 </mesh>)}
 </group>;
}
// The camera and OrbitControls are external Three objects: synchronize them in an effect.
/* oxlint-disable react/immutability */
// Three.js cameras and controls are mutable external objects synchronized in an effect.
export function ReferenceCamera({ geometry, settings }: {
    geometry: ReferenceGeometry;
    settings: ReferenceSettings;
}) {
    const { camera, controls, size, invalidate } = useThree();
    useEffect(() => { if (!(camera instanceof PerspectiveCamera))
        return; const aligned = alignedCamera(geometry, settings, size.width / Math.max(1, size.height)); camera.position.copy(aligned.camera.position); camera.fov = aligned.camera.fov; camera.near = .05; camera.far = 500; camera.lookAt(...aligned.target); camera.updateProjectionMatrix(); if (controls) {
        const orbit = controls as OrbitControlsImpl;
        orbit.target.copy(new Vector3(...aligned.target));
        orbit.update();
    } invalidate(); }, [geometry, settings, camera, controls, size.width, size.height, invalidate]);
    return null;
}

/* oxlint-enable react/immutability */
