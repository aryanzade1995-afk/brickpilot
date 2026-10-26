import { z } from 'zod';
export const REFERENCE_ENGINE_VERSION = 'reference-facade-v1';
const unit = z.number().finite().min(0).max(1);
const id = z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/);
export const imageRectSchema = z.object({ u: unit, v: unit, w: unit.positive(), h: unit.positive() }).strict().refine(r => r.u + r.w <= 1.000001 && r.v + r.h <= 1.000001, 'Rectangle exceeds the selected facade crop');
const observed = { id, rect: imageRectSchema, confidence: unit, evidence: z.enum(['observed', 'inferred', 'manual']), materialId: id.nullable(), depthRatio: z.number().finite().positive().max(.5).nullable() };
export const volumeSchema = z.object({ ...observed, type: z.enum(['main', 'projection', 'recess', 'setback']), parentId: id.nullable(), frontOffsetRatio: z.number().finite().min(-.5).max(.5).nullable().default(null) }).strict();
export const openingSchema = z.object({ ...observed, type: z.enum(['window', 'door', 'sliding-door']), hostId: id }).strict();
export const featureSchema = z.object({ ...observed, type: z.enum(['frame', 'c-frame', 'portal', 'fin-screen', 'louver-screen', 'pergola', 'feature-wall', 'column', 'canopy', 'roof-slab', 'parapet', 'balcony', 'planter']), hostId: id.nullable(), count: z.number().int().min(1).max(24), thicknessRatio: z.number().finite().min(.005).max(.15) }).strict();
export const referenceSpecSchema = z.object({
    version: z.literal(1),
    source: z.object({ imageHash: z.string().regex(/^[a-f0-9]{64}$/), imageWidth: z.number().int().min(64).max(12000), imageHeight: z.number().int().min(64).max(12000), mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp']), crop: imageRectSchema, provider: z.string().max(80), cameraView: z.enum(['front', 'left-oblique', 'right-oblique', 'unknown']) }).strict(),
    envelope: z.object({ widthHeightRatio: z.number().finite().min(.25).max(10), floorCount: z.number().int().min(1).max(4), confidence: unit }).strict(),
    camera: z.object({ azimuthDeg: z.number().finite().min(-80).max(80).nullable(), elevationDeg: z.number().finite().min(0).max(70).nullable(), focalLengthMm: z.number().finite().min(18).max(120).nullable() }).strict(),
    volumes: z.array(volumeSchema).max(24), openings: z.array(openingSchema).max(100), features: z.array(featureSchema).max(80),
    materials: z.array(z.object({ id, type: z.enum(['plaster', 'stone', 'wood', 'metal', 'glass']), color: z.string().regex(/^#[0-9a-fA-F]{6}$/), roughness: unit, metallic: unit, confidence: unit }).strict()).max(24),
    assumptions: z.array(z.string().min(1).max(400)).max(50),
}).strict().superRefine((s, ctx) => {
    const items = [...s.volumes, ...s.openings, ...s.features], ids = new Set<string>(), hosts = new Set(s.volumes.map(v => v.id)), materials = new Set(s.materials.map(m => m.id));
    for (const item of items) {
        if (ids.has(item.id))
            ctx.addIssue({ code: 'custom', message: `Duplicate component ID: ${item.id}` });
        ids.add(item.id);
        if (item.materialId && !materials.has(item.materialId))
            ctx.addIssue({ code: 'custom', message: `Unknown material for ${item.id}` });
    }
    if (materials.size !== s.materials.length)
        ctx.addIssue({ code: 'custom', message: 'Duplicate material IDs' });
    for (const v of s.volumes) {
        if (v.parentId && !hosts.has(v.parentId))
            ctx.addIssue({ code: 'custom', message: `Unknown parent for ${v.id}` });
        const seen = new Set([v.id]);
        let next = v.parentId;
        while (next) {
            if (seen.has(next)) {
                ctx.addIssue({ code: 'custom', message: `Cyclic parent at ${v.id}` });
                break;
            }
            seen.add(next);
            next = s.volumes.find(x => x.id === next)?.parentId ?? null;
        }
    }
    for (const item of [...s.openings, ...s.features])
        if (item.hostId && !hosts.has(item.hostId))
            ctx.addIssue({ code: 'custom', message: `Unknown host for ${item.id}` });
    for (const op of s.openings) {
        const host = s.volumes.find(v => v.id === op.hostId);
        if (host && (op.rect.u < host.rect.u || op.rect.v < host.rect.v || op.rect.u + op.rect.w > host.rect.u + host.rect.w + .00001 || op.rect.v + op.rect.h > host.rect.v + host.rect.h + .00001))
            ctx.addIssue({ code: 'custom', message: `Opening ${op.id} lies outside its host` });
    }
});
export type ReferenceFacadeSpec = z.infer<typeof referenceSpecSchema>;
export type ReferenceFeature = z.infer<typeof featureSchema>;
export const referenceSettingsSchema = z.object({ operation: z.enum(['reconstruction', 'style-transfer']), mode: z.enum(['preserve-plan', 'reference-led']), side: z.enum(['N', 'E', 'S', 'W']), knownWidthMm: z.number().finite().min(2000).max(60000).nullable(), knownHeightMm: z.number().finite().min(2200).max(18000).nullable(), depthMm: z.number().finite().min(2000).max(40000).nullable(), azimuthDeg: z.number().finite().min(-80).max(80), elevationDeg: z.number().finite().min(0).max(70), focalLengthMm: z.number().finite().min(18).max(120), framing: z.number().finite().min(.5).max(3), showBuilding: z.boolean(), showReference: z.boolean(), edits: z.record(id, z.object({ uDelta: z.number().finite().min(-.5).max(.5).optional(), vDelta: z.number().finite().min(-.5).max(.5).optional(), widthScale: z.number().finite().min(.25).max(2).optional(), heightScale: z.number().finite().min(.25).max(2).optional(), depthRatio: z.number().finite().positive().max(.5).optional() }).strict()).refine(v => Object.keys(v).length <= 200, 'Too many component edits').default({}) }).strict();
export type ReferenceSettings = z.infer<typeof referenceSettingsSchema>;
export const defaultReferenceSettings = (): ReferenceSettings => ({ operation: 'reconstruction', mode: 'preserve-plan', side: 'S', knownWidthMm: null, knownHeightMm: null, depthMm: null, azimuthDeg: 0, elevationDeg: 12, focalLengthMm: 45, framing: 1.4, showBuilding: true, showReference: true, edits: {} });
export function parseReferenceSpec(value: unknown) {
    if (value && typeof value === 'object' && 'version' in value && value.version === 0 && 'units' in value && value.units === 'pixels') {
        const old = structuredClone(value) as Record<string, unknown>, source = old.source as Record<string, number>;
        if (!source || !Number.isFinite(source.imageWidth) || !Number.isFinite(source.imageHeight))
            throw new Error('Legacy image dimensions are missing');
        for (const field of ['volumes', 'openings', 'features'])
            if (Array.isArray(old[field]))
                old[field] = old[field].map((e: Record<string, unknown>) => { const r = e.rect as {
                    u: number;
                    v: number;
                    w: number;
                    h: number;
                }; return { ...e, rect: { u: r.u / source.imageWidth, v: r.v / source.imageHeight, w: r.w / source.imageWidth, h: r.h / source.imageHeight } }; });
        old.version = 1;
        delete old.units;
        return referenceSpecSchema.parse(old);
    }
    return referenceSpecSchema.parse(value);
}
export const referenceDocumentSchema = z.object({ version: z.literal(1), sourcePlanId: z.string().min(1).max(160), imageId: z.string().regex(/^[a-f0-9]{64}$/).nullable(), spec: referenceSpecSchema.nullable(), settings: referenceSettingsSchema, accepted: z.object({ spec: referenceSpecSchema, settings: referenceSettingsSchema, signature: z.string().max(160) }).nullable(), enabled: z.boolean() }).strict();
export type ReferenceDocument = z.infer<typeof referenceDocumentSchema>;
export function parseReferenceDocument(v: unknown): ReferenceDocument | null { const r = referenceDocumentSchema.safeParse(v); return r.success ? r.data : null; }
