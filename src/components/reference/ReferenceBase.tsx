import { useMemo } from 'react';
import type { Design } from '@/lib/engine/types.ts';
import { buildMassing } from '@/lib/three/buildMassing.ts';
import type { ReferenceGeometry } from '@/lib/reference/reconstruct.ts';
import { MassingModel } from '@/lib/three/MassingScene.tsx';
const HIDDEN = new Set<never>();
/** Same fallback geometry used by the existing massing preview, transformed
 * from centred (+Y south) study space into the canonical GLB world. */
export function ReferenceBase({ design, style }: {
    design: Design;
    style?: ReferenceGeometry['style'];
}) { const massing = useMemo(() => buildMassing(design), [design]); return <group position={[design.model.plot.width / 2000, -.4, -design.model.plot.depth / 2000]} scale={[1, 1, -1]}><MassingModel massing={massing} explode={0} hidden={HIDDEN} character={design.model.brief.style.character} materialOverrides={style ? Object.fromEntries(Object.entries({ shell: style.primary_wall, feature: style.accent, clad: style.wood, metal: style.metal, glazing: style.glass }).filter(([, v]) => v).map(([k, v]) => [k, { color: v!.color, roughness: v!.roughness, metalness: v!.metallic, opacity: v!.opacity }])) : undefined}/></group>; }
