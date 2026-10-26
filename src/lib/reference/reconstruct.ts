import type { BuildingModel } from '../engine/buildingModel.ts';
import { rectUnionEdges } from '../geometry.ts';
import { fnv } from '../engine/massing/rng.ts';
import { quantityRules } from '../cost/data/quantityRules.ts';
import { parseReferenceSpec, referenceSettingsSchema, REFERENCE_ENGINE_VERSION, type ReferenceSettings } from './schema.ts';
export type ReferencePart = {
    id: string;
    ownerId: string;
    parentId: string | null;
    semantic: string;
    sourceImage: string;
    positionMm: [
        number,
        number,
        number
    ];
    sizeMm: [
        number,
        number,
        number
    ];
    material: {
        color: string;
        roughness: number;
        metallic: number;
        opacity: number;
    };
    confidence: number;
    evidence: string;
};
export type ReferenceIssue = {
    code: string;
    severity: 'error' | 'warning';
    componentId: string | null;
    message: string;
    correction: string;
};
export type ReferenceGeometry = {
    version: string;
    signature: string;
    sourcePlanId: string;
    mode: ReferenceSettings['mode'];
    status: 'valid' | 'needs-review' | 'rejected';
    parts: ReferencePart[];
    issues: ReferenceIssue[];
    frame: FacadeFrame;
    referenceOpenings: {
        id: string;
        u: number;
        v: number;
        w: number;
        h: number;
    }[];
    style: Record<string, ReferencePart['material']>;
    qualifications: string[];
};
export type FacadeFrame = {
    origin: [
        number,
        number
    ];
    right: [
        number,
        number
    ];
    normal: [
        number,
        number
    ];
    widthMm: number;
    heightMm: number;
    depthMm: number;
    side: ReferenceSettings['side'];
};
export const REFERENCE_CONCEPT_LIMITS = { version: 'concept-clearance-v1', minimumMeshMm: 5, studyWallMm: 180, windowClearanceMm: 100, doorClearanceMm: 250, maximumParts: 600 } as const;
const solidMaterial = { color: '#E9E3D7', roughness: .8, metallic: 0, opacity: 1 };
export function facadeFrame(b: BuildingModel, s: ReferenceSettings): FacadeFrame {
    const rects = b.floors.flatMap(f => f.footprint), minX = Math.min(...rects.map(r => r.x)), minY = Math.min(...rects.map(r => r.y)), maxX = Math.max(...rects.map(r => r.x + r.w)), maxY = Math.max(...rects.map(r => r.y + r.h));
    if (!rects.length || ![minX, minY, maxX, maxY].every(Number.isFinite))
        throw new Error('The source building has no usable facade');
    const basis = { N: { origin: [minX, minY], right: [1, 0], normal: [0, -1] }, S: { origin: [maxX, maxY], right: [-1, 0], normal: [0, 1] }, E: { origin: [maxX, minY], right: [0, 1], normal: [1, 0] }, W: { origin: [minX, maxY], right: [0, -1], normal: [-1, 0] } }[s.side];
    return { ...basis, origin: basis.origin as [
            number,
            number
        ], right: basis.right as [
            number,
            number
        ], normal: basis.normal as [
            number,
            number
        ], side: s.side, widthMm: s.knownWidthMm ?? (['N', 'S'].includes(s.side) ? maxX - minX : maxY - minY), heightMm: s.knownHeightMm ?? Math.max(...b.floors.map(f => f.elevationMm + f.heightMm)), depthMm: s.depthMm ?? (['N', 'S'].includes(s.side) ? maxY - minY : maxX - minX) };
}
/** Image u goes right and v down in the selected crop. Plan is mm, X east,
 * Y south, Z up. Depth is positive outward from the selected facade.
 * Three=(X,Z,-Y)/1000; Blender=(X,Y,Z)/1000. Road side is not true north. */
export function facadePoint(f: FacadeFrame, u: number, v: number, depthMm = 0): [
    number,
    number,
    number
] { return [Math.round(f.origin[0] + f.right[0] * u * f.widthMm + f.normal[0] * depthMm), Math.round(f.origin[1] + f.right[1] * u * f.widthMm + f.normal[1] * depthMm), Math.round((1 - v) * f.heightMm)]; }
export const referenceToThree = (p: readonly number[]): [
    number,
    number,
    number
] => [p[0] / 1000, p[2] / 1000, -p[1] / 1000];
export function sourceFacadeOpenings(b: BuildingModel, f: FacadeFrame) {
    return [...b.windows, ...b.doors].flatMap(o => {
        const floor = b.floors.find(x => x.id === o.floorId);
        if (!floor)
            return [];
        const depth = (o.at.x - f.origin[0]) * f.normal[0] + (o.at.y - f.origin[1]) * f.normal[1];
        if (Math.abs(depth) > 300 || (['N', 'S'].includes(f.side) ? o.orient !== 'h' : o.orient !== 'v'))
            return [];
        const along = (o.at.x - f.origin[0]) * f.right[0] + (o.at.y - f.origin[1]) * f.right[1], limits = floor.openingLimits ?? quantityRules.openingLimits;
        const sill = o.kind === 'window' ? o.sill ?? limits.defaultSillMm : 0, head = o.head ?? (o.kind === 'window' ? limits.windowHeadMm : o.kind === 'entry' ? limits.entryHeadMm : limits.doorHeadMm);
        return [{ id: o.id!, kind: o.kind, u: (along - o.width / 2) / f.widthMm, v: 1 - (floor.elevationMm + head) / f.heightMm, w: o.width / f.widthMm, h: (head - sill) / f.heightMm }];
    });
}
function rectParts(outer: {
    u: number;
    v: number;
    w: number;
    h: number;
}, holes: {
    u: number;
    v: number;
    w: number;
    h: number;
}[]) {
    let cells = [outer];
    for (const hole of holes)
        cells = cells.flatMap(r => {
            const x = Math.max(r.u, hole.u), y = Math.max(r.v, hole.v), right = Math.min(r.u + r.w, hole.u + hole.w), bottom = Math.min(r.v + r.h, hole.v + hole.h);
            if (right <= x || bottom <= y)
                return [r];
            return [{ u: r.u, v: r.v, w: x - r.u, h: r.h }, { u: right, v: r.v, w: r.u + r.w - right, h: r.h }, { u: x, v: r.v, w: right - x, h: y - r.v }, { u: x, v: bottom, w: right - x, h: r.v + r.h - bottom }].filter(p => p.w > 1e-6 && p.h > 1e-6);
        });
    return cells;
}
export function reconstructFacade(building: BuildingModel, input: unknown, configuration: unknown): ReferenceGeometry {
    const observations = parseReferenceSpec(input), settings = referenceSettingsSchema.parse(configuration), edited = structuredClone(observations);
    for (const [id, edit] of Object.entries(settings.edits)) {
        const item = [...edited.volumes, ...edited.openings, ...edited.features].find(e => e.id === id);
        if (!item)
            throw new Error(`Unknown component edit: ${id}`);
        item.rect = { u: item.rect.u + (edit.uDelta ?? 0), v: item.rect.v + (edit.vDelta ?? 0), w: item.rect.w * (edit.widthScale ?? 1), h: item.rect.h * (edit.heightScale ?? 1) };
        if (edit.depthRatio !== undefined)
            item.depthRatio = edit.depthRatio;
    }
    const spec = parseReferenceSpec(edited), f = facadeFrame(building, settings), issues: ReferenceIssue[] = [], parts: ReferencePart[] = [];
    const issue = (code: string, severity: ReferenceIssue['severity'], componentId: string | null, message: string, correction: string) => issues.push({ code, severity, componentId, message, correction });
    if (settings.mode === 'reference-led' && settings.operation === 'reconstruction' && !settings.knownHeightMm) {
        // Preserve the crop's pixel aspect for the separate envelope study.
        // This is a source-width-scaled image plane, never a recovered measurement.
        f.heightMm = Math.round(f.widthMm * spec.source.imageHeight * spec.source.crop.h / (spec.source.imageWidth * spec.source.crop.w));
        issue('IMAGE_SCALE_ESTIMATED', 'warning', null, 'Study proportions follow the image crop, scaled from the source width. Photograph perspective and hidden depth remain uncertain.', 'Enter known facade dimensions and align the camera; reconcile the resulting envelope with the actual floor plan.');
        if (f.heightMm < 2200 || f.heightMm > 18000)
            issue('STUDY_HEIGHT_UNSUPPORTED', 'error', null, 'The crop-derived study height is outside the supported 2.2–18 m envelope.', 'Crop the facade more closely or supply measured dimensions.');
        if (spec.envelope.floorCount !== building.floors.length)
            issue('FLOOR_COUNT_DIFFERS', 'warning', null, 'The reference floor count differs from the source brief. No source floor was added or removed.', 'Reconcile the requested floors in the existing planner.');
    }
    const openings = sourceFacadeOpenings(building, f);
    const material = (materialId: string | null, glass = false): ReferencePart['material'] => { const m = spec.materials.find(x => x.id === materialId); return { ...(m ? { color: m.color, roughness: m.roughness, metallic: m.metallic } : solidMaterial), opacity: (glass || m?.type === 'glass') ? .3 : 1 }; };
    const add = (owner: {
        id: string;
        confidence: number;
        evidence: string;
        materialId: string | null;
    }, suffix: string, rect: {
        u: number;
        v: number;
        w: number;
        h: number;
    }, depth: number, thickness: number, semantic: string, parentId: string | null = null, glass = false) => {
        if (rect.w <= 0 || rect.h <= 0 || thickness <= 0)
            return;
        const p = facadePoint(f, rect.u + rect.w / 2, rect.v + rect.h / 2, depth), w = Math.round(rect.w * f.widthMm), h = Math.round(rect.h * f.heightMm), d = Math.round(thickness);
        if (Math.min(w, h, d) < REFERENCE_CONCEPT_LIMITS.minimumMeshMm) {
            issue('DETAIL_TOO_SMALL', 'warning', owner.id, 'This detail is below the supported 5 mm mesh size.', 'Increase its dimensions.');
            return;
        }
        parts.push({ id: `ref_${owner.id}_${suffix}`, ownerId: owner.id, parentId, semantic, sourceImage: spec.source.imageHash, positionMm: p, sizeMm: ['N', 'S'].includes(f.side) ? [w, d, h] : [d, w, h], material: material(owner.materialId, glass), confidence: owner.confidence, evidence: owner.evidence });
    };
    const style: ReferenceGeometry['style'] = {};
    for (const m of spec.materials) {
        const roles = { plaster: ['primary_wall', 'secondary_wall', 'wall'], stone: ['accent', 'stone'], wood: ['wood', 'timber'], metal: ['metal'], glass: ['glass'] }[m.type];
        for (const role of roles)
            if (!style[role])
                style[role] = { color: m.color, roughness: m.roughness, metallic: m.metallic, opacity: m.type === 'glass' ? .3 : 1 };
    }
    const volumeOffset = (id: string): number => { const volume = spec.volumes.find(x => x.id === id); if (!volume)
        return 0; return (volume.frontOffsetRatio ?? 0) * f.widthMm + (volume.parentId ? volumeOffset(volume.parentId) : 0); };
    if (settings.operation === 'reconstruction') {
        if (settings.mode === 'preserve-plan') {
            if (settings.knownWidthMm && Math.abs(settings.knownWidthMm - facadeFrame(building, { ...settings, knownWidthMm: null }).widthMm) > 20)
                issue('PLAN_WIDTH_LOCKED', 'error', null, 'A known width cannot resize the occupied source plan in preservation mode.', 'Use the actual source width or switch to a reference-led study.');
            if (settings.knownHeightMm && Math.abs(settings.knownHeightMm - Math.max(...building.floors.map(x => x.elevationMm + x.heightMm))) > 20)
                issue('PLAN_HEIGHT_LOCKED', 'error', null, 'Source floor heights are fixed.', 'Clear the height override or use a reference-led study.');
            if (spec.envelope.floorCount !== building.floors.length)
                issue('FLOOR_COUNT_DIFFERS', 'warning', null, 'The photograph has a different visible floor count. The source floors are preserved.', 'Use reference-led mode if a new envelope is intended.');
            for (const v of spec.volumes)
                issue('OCCUPIED_VOLUME_PRESERVED', 'warning', v.id, `${v.type} volume is recorded but cannot move or replace occupied source rooms.`, 'Use supported facade details, or propose a separate reference-led envelope.');
            for (const o of spec.openings) {
                const match = openings.some(p => Math.abs((p.u + p.w / 2) - (o.rect.u + o.rect.w / 2)) < .08 && Math.abs((p.v + p.h / 2) - (o.rect.v + o.rect.h / 2)) < .1 && ((o.type === 'window') === (p.kind === 'window')));
                if (!match)
                    issue('OPENING_PLAN_MISMATCH', 'warning', o.id, 'This photographed opening does not match a source opening. No opening was added or removed.', 'Reconcile it in the 2D planner or retain the real opening.');
            }
        }
        else {
            issue('ROOM_RECONCILIATION_REQUIRED', 'warning', null, 'Reference-led volumes are an exterior study, not a validated new room plan. Hidden elevations and depths are uncertain.', 'Reconcile room planning, circulation, structure and services before using this as a house plan.');
            for (const v of spec.volumes) {
                const bottom = (1 - v.rect.v - v.rect.h) * f.heightMm, top = (1 - v.rect.v) * f.heightMm;
                if (!building.floors.some(floor => Math.abs(bottom - floor.elevationMm) < 100) || !building.floors.some(floor => Math.abs(top - floor.elevationMm - floor.heightMm) < 100))
                    issue('FLOOR_ALIGNMENT_UNVERIFIED', 'warning', v.id, 'Observed volume boundaries do not align with recorded source floor levels.', 'Reconcile the proposal with floor levels in the existing planner; no floor was changed.');
                if (v.depthRatio === null) {
                    issue('DEPTH_UNKNOWN', 'error', v.id, 'A volume depth is unknown. No solid was invented.', 'Enter an estimated or measured depth in the component editor.');
                    continue;
                }
                const depth = Math.round(v.depthRatio * f.widthMm), r = v.rect, t = REFERENCE_CONCEPT_LIMITS.studyWallMm, offset = volumeOffset(v.id);
                if (['projection', 'setback', 'recess'].includes(v.type) && v.frontOffsetRatio === null) {
                    issue('OFFSET_UNKNOWN', 'error', v.id, 'This volume needs an explicit signed front-plane offset; perspective alone cannot establish it.', 'Enter a measured or estimated front offset in the component editor.');
                    continue;
                }
                if (v.type === 'recess' && (!v.parentId || offset >= volumeOffset(v.parentId))) {
                    issue('INVALID_RECESS', 'error', v.id, 'A recess must have a host and sit behind its host facade.', 'Choose a parent volume and a negative relative front offset.');
                    continue;
                }
                const cuts = [...spec.openings.filter(o => o.hostId === v.id).map(o => o.rect), ...spec.volumes.filter(c => c.parentId === v.id && c.type === 'recess' && c.frontOffsetRatio !== null).map(c => c.rect)];
                rectParts(r, cuts).forEach((cell, i) => add(v, `front_${i}`, cell, offset - t / 2, t, 'facade-wall', v.parentId));
                add(v, 'back', r, offset - depth + t / 2, t, 'inferred-rear-wall', v.parentId);
                add(v, 'left', { ...r, w: t / f.widthMm }, offset - depth / 2, depth, 'side-return', v.parentId);
                add(v, 'right', { ...r, u: r.u + r.w - t / f.widthMm, w: t / f.widthMm }, offset - depth / 2, depth, 'side-return', v.parentId);
                add(v, 'top', { ...r, h: t / f.heightMm }, offset - depth / 2, depth, 'roof-slab', v.parentId);
                add(v, 'bottom', { ...r, v: r.v + r.h - t / f.heightMm, h: t / f.heightMm }, offset - depth / 2, depth, 'floor-slab', v.parentId);
                if (v.rect.v + v.rect.h < .98 && !spec.features.some(x => x.type === 'column' && Math.abs(x.rect.u + x.rect.w / 2 - v.rect.u - v.rect.w / 2) < v.rect.w / 2))
                    issue('SUPPORT_UNVERIFIED', 'warning', v.id, 'Upper volume support and cantilever structure are not known from this photograph.', 'Have a structural engineer confirm the support; add observed columns where applicable.');
            }
            for (const o of spec.openings) {
                const offset = volumeOffset(o.hostId);
                add(o, 'pane', o.rect, offset - 60, 30, o.type, o.hostId, o.type !== 'door');
                const t = .012;
                for (const [i, r] of frameRects(o.rect, t, t, 'frame').entries())
                    add(o, `frame_${i}`, r, offset - 25, 65, 'opening-frame', o.hostId);
            }
        }
        for (const e of spec.features) {
            if (settings.mode === 'reference-led' && !e.hostId) {
                issue('FEATURE_HOST_UNKNOWN', 'error', e.id, 'A reference-led feature has no confirmed host volume.', 'Mark its building volume and choose that host in the component editor.');
                continue;
            }
            if (settings.mode === 'reference-led' && e.hostId) {
                const host=spec.volumes.find(v=>v.id===e.hostId)!;
                if(e.rect.u+e.rect.w<host.rect.u || e.rect.u>host.rect.u+host.rect.w || e.rect.v+e.rect.h<host.rect.v || e.rect.v>host.rect.v+host.rect.h) {
                    issue('DISCONNECTED_FEATURE','error',e.id,'This feature is disconnected from its observed host envelope.','Move it to its host or choose the correct host volume.');
                    continue;
                }
            }
            if (e.depthRatio === null) {
                issue('DEPTH_UNKNOWN', 'error', e.id, 'The feature depth is unknown.', 'Enter an estimated or measured projection in the component editor.');
                continue;
            }
            const depth = e.depthRatio * f.widthMm, t = e.thicknessRatio, r = e.rect, offset = settings.mode === 'reference-led' && e.hostId ? volumeOffset(e.hostId) : 0;
            if (e.confidence < .6 || e.evidence === 'inferred')
                issue('UNCERTAIN_OBSERVATION', 'warning', e.id, 'This component is uncertain or inferred.', 'Review its image position, depth and dimensions before accepting.');
            if (['frame', 'c-frame', 'portal'].includes(e.type)) {
                for (const [i, cell] of frameRects(r, t, t * f.widthMm / f.heightMm, e.type).entries())
                    add(e, `part_${i}`, cell, offset + depth / 2, depth, e.type, e.hostId);
            }
            else if (['fin-screen', 'louver-screen', 'pergola'].includes(e.type)) {
                const vertical = e.type === 'fin-screen';
                for (let i = 0; i < e.count; i++) {
                    const cell = vertical ? { u: r.u + i * r.w / e.count, v: r.v, w: Math.min(t, r.w / e.count * .6), h: r.h } : { u: r.u, v: r.v + i * r.h / e.count, w: r.w, h: Math.min(t * f.widthMm / f.heightMm, r.h / e.count * .6) };
                    add(e, `slat_${i}`, cell, offset + depth / 2, depth, e.type, e.hostId);
                }
            }
            else if (e.type === 'balcony') {
                issue('BALCONY_ACCESS_UNVERIFIED', 'warning', e.id, 'A balcony requires a real source door, guard and structural support; a photo alone cannot prove access.', 'Confirm a source exterior doorway, guard dimensions and support before architectural acceptance.');
                if (settings.mode === 'preserve-plan' && !openings.some(o => o.kind !== 'window' && o.u + o.w > r.u && o.u < r.u + r.w && Math.abs((1-o.v-o.h)*f.heightMm-(1-r.v-r.h)*f.heightMm)<300))
                    issue('BALCONY_NO_SOURCE_ACCESS', 'error', e.id, 'This proposed balcony has no recorded source doorway at its floor level.', 'Use an existing accessible balcony or reconcile an exterior door in the 2D planner first.');
                add(e, 'slab', { ...r, v: r.v + r.h - t, h: t }, offset + depth / 2, depth, 'balcony-slab', e.hostId);
                for (const [i, cell] of frameRects(r, t, t * f.widthMm / f.heightMm, 'portal').entries())
                    add(e, `guard_${i}`, cell, offset + depth, 45, 'balcony-guard', e.hostId, true);
            }
            else
                add(e, 'solid', r, offset + depth / 2, depth, e.type, e.hostId);
        }
    }
    if (parts.length > REFERENCE_CONCEPT_LIMITS.maximumParts)
        issue('MESH_BUDGET', 'error', null, 'Too many generated pieces.', 'Reduce feature counts below 600 parts.');
    const buildable = building.plot.buildable;
    for (const p of parts) {
        const [x, y, z] = p.positionMm, [w, d, h] = p.sizeMm;
        if (![x, y, z, w, d, h].every(Number.isFinite) || Math.min(w, d, h) <= 0)
            issue('INVALID_SOLID', 'error', p.ownerId, 'Non-finite or non-positive solid.', 'Correct the component dimensions.');
        if (x - w / 2 < buildable.x - 5 || y - d / 2 < buildable.y - 5 || x + w / 2 > buildable.x + buildable.w + 5 || y + d / 2 > buildable.y + buildable.h + 5)
            issue('SETBACK_VIOLATION', 'error', p.ownerId, 'The component exceeds the source buildable envelope.', 'Reduce its projection or move it inward; setbacks are not relaxed.');
        if (z - h / 2 < -5 || z + h / 2 > f.heightMm + 300)
            issue('FACADE_HEIGHT', 'error', p.ownerId, 'The part exceeds the facade height.', 'Keep the part within the selected facade envelope.');
        if (settings.mode === 'preserve-plan') {
            const delta = [x - f.origin[0], y - f.origin[1]], u = (delta[0] * f.right[0] + delta[1] * f.right[1]) / f.widthMm, depth = delta[0] * f.normal[0] + delta[1] * f.normal[1], along = ['N', 'S'].includes(f.side) ? w : d, normal = ['N', 'S'].includes(f.side) ? d : w;
            if (depth - normal / 2 < -20)
                issue('OCCUPIED_PLAN_INTERSECTION', 'error', p.ownerId, 'This detail penetrates the occupied source facade.', 'Keep added geometry outside the source wall.');
            for (const op of openings) {
                const clear = op.kind === 'window' ? REFERENCE_CONCEPT_LIMITS.windowClearanceMm : REFERENCE_CONCEPT_LIMITS.doorClearanceMm;
                if (u + along / (2 * f.widthMm) > op.u - clear / f.widthMm && u - along / (2 * f.widthMm) < op.u + op.w + clear / f.widthMm && z + h / 2 > (1 - op.v - op.h) * f.heightMm - clear && z - h / 2 < (1 - op.v) * f.heightMm + clear && depth - normal / 2 < 1200)
                    issue('OPENING_CLEARANCE', 'error', p.ownerId, `Component obstructs source ${op.kind} ${op.id}.`, 'Move/resize the feature to leave this opening and its access clear.');
            }
            // Reject floating cladding over gaps between disconnected source wings.
            const faces = building.floors.filter(floor => z + h / 2 >= floor.elevationMm && z - h / 2 <= floor.elevationMm + floor.heightMm).flatMap(floor => rectUnionEdges(floor.footprint, floor.courtyard)).filter(edge => edge.side === f.side && Math.abs((edge.a.x - f.origin[0]) * f.normal[0] + (edge.a.y - f.origin[1]) * f.normal[1]) < 25);
            const anchored = faces.some(edge => { const a = (edge.a.x - f.origin[0]) * f.right[0] + (edge.a.y - f.origin[1]) * f.right[1], b = (edge.b.x - f.origin[0]) * f.right[0] + (edge.b.y - f.origin[1]) * f.right[1]; return u * f.widthMm + along / 2 > Math.min(a, b) && u * f.widthMm - along / 2 < Math.max(a, b); });
            if (!anchored)
                issue('NO_SOURCE_ANCHOR', 'error', p.ownerId, 'No source envelope anchor exists.', 'Choose a valid source facade.');
        }
    }
    for (let i = 0; i < parts.length; i++)
        for (let j = i + 1; j < parts.length; j++) {
            const a = parts[i], b = parts[j];
            if (a.ownerId === b.ownerId || a.ownerId === b.parentId || b.ownerId === a.parentId)
                continue;
            if (a.positionMm.every((v, k) => Math.min(v + a.sizeMm[k] / 2, b.positionMm[k] + b.sizeMm[k] / 2) - Math.max(v - a.sizeMm[k] / 2, b.positionMm[k] - b.sizeMm[k] / 2) > 10))
                issue('COMPONENT_COLLISION', 'error', a.ownerId, `Solid overlaps ${b.ownerId}.`, 'Move or resize one of these separate components.');
        }
    const unique = [...new Map(issues.map(x => [`${x.code}:${x.componentId}:${x.message}`, x])).values()];
    return { version: REFERENCE_ENGINE_VERSION, signature: `ref-${fnv(JSON.stringify([REFERENCE_ENGINE_VERSION, building.planId, spec, settings]))}`, sourcePlanId: building.planId, mode: settings.mode, status: unique.some(x => x.severity === 'error') ? 'rejected' : unique.length ? 'needs-review' : 'valid', parts, issues: unique, frame: f, referenceOpenings: openings, style, qualifications: [...spec.assumptions, 'Single-image dimensions and hidden geometry are not exact recovery.', settings.knownWidthMm ? 'Width supplied by the user.' : 'Scale uses the actual source building width, not a measured photograph.', 'Concept clearances: 100 mm at windows and 250 mm at doors; study shell thickness 180 mm. These are configurable visualization assumptions, not statutory compliance.', 'Facade additions are not priced in the existing house BOQ.', 'Architecture and structural review remain required.'] };
}
function frameRects(r: {
    u: number;
    v: number;
    w: number;
    h: number;
}, tx: number, ty: number, kind: string) { const x = Math.min(tx, r.w / 3), y = Math.min(ty, r.h / 3), cells = [{ u: r.u, v: r.v, w: x, h: r.h }, { u: r.u + x, v: r.v, w: r.w - x * 2, h: y }]; if (kind !== 'c-frame')
    cells.push({ u: r.u + r.w - x, v: r.v, w: x, h: r.h }); if (kind === 'frame' || kind === 'c-frame')
    cells.push({ u: r.u + x, v: r.v + r.h - y, w: r.w - x * 2, h: y }); return cells; }
