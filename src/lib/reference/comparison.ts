import { PerspectiveCamera, Vector3 } from 'three';
import type { BuildingModel } from '../engine/buildingModel.ts';
import { reconstructFacade, referenceToThree, type ReferenceGeometry } from './reconstruct.ts';
import type { ReferenceFacadeSpec, ReferenceSettings } from './schema.ts';
export type AlignmentRect = {
    u: number;
    v: number;
    w: number;
    h: number;
};
export function overlapScore(a: AlignmentRect, b: AlignmentRect) { const intersection = Math.max(0, Math.min(a.u + a.w, b.u + b.w) - Math.max(a.u, b.u)) * Math.max(0, Math.min(a.v + a.h, b.v + b.h) - Math.max(a.v, b.v)); return intersection / Math.max(1e-12, a.w * a.h + b.w * b.h - intersection); }
export function alignedCamera(g: ReferenceGeometry, s: ReferenceSettings, aspect = 1) {
    const f = g.frame, target = referenceToThree([f.origin[0] + f.right[0] * f.widthMm / 2, f.origin[1] + f.right[1] * f.widthMm / 2, f.heightMm / 2]), az = s.azimuthDeg * Math.PI / 180, el = s.elevationDeg * Math.PI / 180;
    const camera = new PerspectiveCamera(2 * Math.atan(36 / (2 * s.focalLengthMm)) * 180 / Math.PI, aspect, .05, 500), span = Math.max(f.widthMm / 1000 / aspect, f.heightMm / 1000), distance = span / (2 * Math.tan(camera.fov * Math.PI / 360)) * s.framing;
    const nx = f.normal[0] * Math.cos(az) + f.right[0] * Math.sin(az), nz = -(f.normal[1] * Math.cos(az) + f.right[1] * Math.sin(az));
    camera.position.set(target[0] + nx * distance * Math.cos(el), target[1] + distance * Math.sin(el), target[2] + nz * distance * Math.cos(el));
    camera.up.set(0, 1, 0);
    camera.lookAt(...target);
    camera.updateMatrixWorld();
    camera.updateProjectionMatrix();
    return { camera, target };
}
export function projectedComponents(g: ReferenceGeometry, s: ReferenceSettings, aspect = 1) {
    const { camera } = alignedCamera(g, s, aspect), groups = new Map<string, number[][]>();
    for (const p of g.parts) {
        const points = groups.get(p.ownerId) ?? [];
        for (const x of [-.5, .5])
            for (const y of [-.5, .5])
                for (const z of [-.5, .5]) {
                    const v = new Vector3(...referenceToThree([p.positionMm[0] + x * p.sizeMm[0], p.positionMm[1] + y * p.sizeMm[1], p.positionMm[2] + z * p.sizeMm[2]])).project(camera);
                    if (Number.isFinite(v.x) && v.z >= -1 && v.z <= 1)
                        points.push([(v.x + 1) / 2, (1 - v.y) / 2]);
                }
        groups.set(p.ownerId, points);
    }
    return [...groups].flatMap(([id, p]) => { if (!p.length)
        return []; const u = Math.min(...p.map(v => v[0])), v = Math.min(...p.map(v => v[1])); return [{ id, u, v, w: Math.max(...p.map(v => v[0])) - u, h: Math.max(...p.map(v => v[1])) - v }]; });
}
/** Feature alignment compares observations with projected real solids, not a
 * generated reference picture. It is conditional on crop/camera alignment. */
export function compareGeometry(spec: ReferenceFacadeSpec, g: ReferenceGeometry, s: ReferenceSettings) {
    const aspect = spec.source.imageWidth * spec.source.crop.w / (spec.source.imageHeight * spec.source.crop.h), projected = projectedComponents(g, s, aspect);
    const observations = [...spec.features, ...(s.mode === 'reference-led' ? spec.volumes : [])], mismatches = observations.map(e => { const p = projected.find(p => p.id === e.id), iou = p ? overlapScore(e.rect, p) : 0; return { id: e.id, iou, confidence: e.confidence, suggestion: !p ? 'Resolve the depth, host or validation issue before alignment.' : Math.abs(p.u - e.rect.u) > .04 ? 'Adjust lateral position or camera azimuth.' : Math.abs(p.h - e.rect.h) > .04 ? 'Adjust the feature height or camera framing.' : 'Review projection, width and perspective.' }; });
    const weight = mismatches.reduce((n, e) => n + e.confidence, 0);
    return { objective: weight ? mismatches.reduce((n, e) => n + e.iou * e.confidence, 0) / weight : null, mismatches, projected, basis: 'confidence-weighted projected component box overlap; not proof of architectural correctness' };
}
export function edgeMap(rgba: ArrayLike<number>, width: number, height: number) {
    if (width < 3 || height < 3 || width * height > 1024 * 1024 || rgba.length !== width * height * 4)
        throw new Error('Use matching images between 3 and 1024 pixels per side');
    const l = new Float32Array(width * height), out = new Uint8Array(width * height);
    for (let i = 0; i < l.length; i++)
        l[i] = .2126 * rgba[i * 4] + .7152 * rgba[i * 4 + 1] + .0722 * rgba[i * 4 + 2];
    for (let y = 1; y < height - 1; y++)
        for (let x = 1; x < width - 1; x++) {
            const i = y * width + x, gx = -l[i - width - 1] + l[i - width + 1] - 2 * l[i - 1] + 2 * l[i + 1] - l[i + width - 1] + l[i + width + 1], gy = -l[i - width - 1] - 2 * l[i - width] - l[i - width + 1] + l[i + width - 1] + 2 * l[i + width] + l[i + width + 1];
            out[i] = Math.hypot(gx, gy) > 90 ? 1 : 0;
        }
    return out;
}
export function comparePixels(a: ArrayLike<number>, b: ArrayLike<number>, width: number, height: number) {
    const ea = edgeMap(a, width, height), eb = edgeMap(b, width, height);
    let na = 0, nb = 0, hitA = 0, hitB = 0, ma = 0, mb = 0;
    const nearby = (map: Uint8Array, i: number) => { const x = i % width, y = Math.floor(i / width); for (let dy = -2; dy <= 2; dy++)
        for (let dx = -2; dx <= 2; dx++)
            if (x + dx >= 0 && x + dx < width && y + dy >= 0 && y + dy < height && map[(y + dy) * width + x + dx])
                return true; return false; };
    for (let i = 0; i < ea.length; i++) {
        if (ea[i]) {
            na++;
            if (nearby(eb, i))
                hitA++;
        }
        if (eb[i]) {
            nb++;
            if (nearby(ea, i))
                hitB++;
        }
        ma += .2126 * a[i * 4] + .7152 * a[i * 4 + 1] + .0722 * a[i * 4 + 2];
        mb += .2126 * b[i * 4] + .7152 * b[i * 4 + 1] + .0722 * b[i * 4 + 2];
    }
    ma /= ea.length;
    mb /= ea.length;
    let va = 0, vb = 0, cov = 0;
    for (let i = 0; i < ea.length; i++) {
        const x = .2126 * a[i * 4] + .7152 * a[i * 4 + 1] + .0722 * a[i * 4 + 2] - ma, y = .2126 * b[i * 4] + .7152 * b[i * 4 + 1] + .0722 * b[i * 4 + 2] - mb;
        va += x * x;
        vb += y * y;
        cov += x * y;
    }
    va /= ea.length;
    vb /= ea.length;
    cov /= ea.length;
    const precision = nb ? hitB / nb : null, recall = na ? hitA / na : null;
    return { edgeF1: precision !== null && recall !== null && precision + recall > 0 ? 2 * precision * recall / (precision + recall) : null, globalToneSimilarity: ((2 * ma * mb + 6.5025) * (2 * cov + 58.5225)) / ((ma * ma + mb * mb + 6.5025) * (va + vb + 58.5225)), referenceEdges: na, renderEdges: nb, basis: 'aligned crop; Sobel edges with 2-pixel tolerance and global luminance SSIM approximation; lighting/background sensitive' };
}
/** Software silhouette render of actual box vertices for bounded CPU candidate
 * evaluation. Each part is rasterized separately, preserving frame openings. */
export function renderSilhouette(g: ReferenceGeometry, s: ReferenceSettings, width = 128, height = 128) {
    const out = new Uint8Array(width * height), { camera } = alignedCamera(g, s, width / height);
    for (const part of g.parts) {
        const points: number[][] = [];
        for (const x of [-.5, .5])
            for (const y of [-.5, .5])
                for (const z of [-.5, .5]) {
                    const p = new Vector3(...referenceToThree([part.positionMm[0] + x * part.sizeMm[0], part.positionMm[1] + y * part.sizeMm[1], part.positionMm[2] + z * part.sizeMm[2]])).project(camera);
                    if (p.z >= -1 && p.z <= 1)
                        points.push([(p.x + 1) * width / 2, (1 - p.y) * height / 2]);
                }
        const hull = convexHull(points);
        if (hull.length < 3)
            continue;
        for (let y = Math.max(0, Math.floor(Math.min(...hull.map(p => p[1])))); y < Math.min(height, Math.ceil(Math.max(...hull.map(p => p[1])))); y++) {
            const crosses: number[] = [];
            for (let i = 0; i < hull.length; i++) {
                const a = hull[i], b = hull[(i + 1) % hull.length];
                if ((a[1] > y + .5) !== (b[1] > y + .5))
                    crosses.push(a[0] + (b[0] - a[0]) * (y + .5 - a[1]) / (b[1] - a[1]));
            }
            crosses.sort((a, b) => a - b);
            for (let j = 0; j + 1 < crosses.length; j += 2)
                for (let x = Math.max(0, Math.floor(crosses[j])); x < Math.min(width, Math.ceil(crosses[j + 1])); x++)
                    out[y * width + x] = 1;
        }
    }
    return out;
}
function convexHull(points: number[][]) { if (points.length < 3)
    return points; const p = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]), cross = (a: number[], b: number[], c: number[]) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]), lo: number[][] = [], hi: number[][] = []; for (const v of p) {
    while (lo.length > 1 && cross(lo.at(-2)!, lo.at(-1)!, v) <= 0)
        lo.pop();
    lo.push(v);
} for (const v of p.reverse()) {
    while (hi.length > 1 && cross(hi.at(-2)!, hi.at(-1)!, v) <= 0)
        hi.pop();
    hi.push(v);
} return [...lo.slice(0, -1), ...hi.slice(0, -1)]; }
export function maskOverlap(a: ArrayLike<number>, b: ArrayLike<number>) { if (a.length !== b.length || !a.length)
    throw new Error('Masks must have matching dimensions'); let union = 0, intersection = 0; for (let i = 0; i < a.length; i++) {
    if (a[i] || b[i])
        union++;
    if (a[i] && b[i])
        intersection++;
} return union ? intersection / union : null; }
export function refineReference(building: BuildingModel, spec: ReferenceFacadeSpec, settings: ReferenceSettings, maxCandidates = 18) {
    const initial = reconstructFacade(building, spec, settings), before = compareGeometry(spec, initial, settings).objective;
    if (before === null)
        return { settings, improved: false, before, after: before, evaluated: 0, reason: 'Mark at least one facade feature before refinement.' };
    let best = settings, score = before, evaluated = 0;
    const changes: {
        id: string;
        parameter: string;
        delta: number;
    }[] = [];
    for (const feature of spec.features)
        for (const parameter of ['uDelta', 'widthScale', 'depthRatio'] as const)
            for (const delta of [-.015, .015]) {
                if (evaluated >= Math.min(36, maxCandidates))
                    break;
                const candidate = structuredClone(settings), edit = candidate.edits[feature.id] ?? {};
                if (parameter === 'depthRatio') {
                    if (feature.depthRatio === null && edit.depthRatio === undefined)
                        continue;
                    edit.depthRatio = (edit.depthRatio ?? feature.depthRatio!) + delta;
                }
                else
                    edit[parameter] = (edit[parameter] ?? (parameter === 'widthScale' ? 1 : 0)) + delta;
                candidate.edits[feature.id] = edit;
                evaluated++;
                try {
                    const geometry = reconstructFacade(building, spec, candidate);
                    if (geometry.status === 'rejected')
                        continue;
                    const silhouette = renderSilhouette(geometry, candidate);
                    if (!silhouette.some(v => v))
                        continue;
                    // Objective must refer to the original observations, not the edited target.
                    const fixedObjective = compareGeometry(spec, geometry, candidate).objective ?? 0;
                    if (fixedObjective > score + 1e-6) {
                        best = candidate;
                        score = fixedObjective;
                        changes.splice(0, changes.length, { id: feature.id, parameter, delta });
                    }
                }
                catch { /* Invalid candidates are rejected; the accepted source is retained. */ }
            }
    return { settings: best, improved: score > before + 1e-6, before, after: score, evaluated, changes, reason: score > before ? 'A validated candidate improved projected feature alignment. Review before applying.' : 'No valid candidate improved the fixed reference objective. Adjust camera/crop or edit manually.' };
}
