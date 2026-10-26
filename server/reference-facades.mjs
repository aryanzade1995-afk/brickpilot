import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, realpath, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { resolve, sep } from 'node:path';
import { z } from 'zod';
import { createBuildingModel } from '../src/lib/engine/buildingModel.ts';
import { validate } from '../src/lib/rules/index.ts';
import { briefSchema } from '../src/lib/model/brief.ts';
import { parseReferenceSpec, referenceSettingsSchema, imageRectSchema, REFERENCE_ENGINE_VERSION } from '../src/lib/reference/schema.ts';
import { reconstructFacade } from '../src/lib/reference/reconstruct.ts';
import { refineReference, alignedCamera } from '../src/lib/reference/comparison.ts';
import { createBlenderInput } from '../scripts/export-blender-input.mjs';
import { PROJECT_ROOT, runBlender } from './blender-process.mjs';
import { writeAtomicJson } from './atomic-json.mjs';
import { storeReferenceImage, readReferenceImage } from './reference-images.mjs';
import { analyzeReferenceVision, referenceVisionHealth, REFERENCE_VISION_PROMPT } from './providers/reference-vision.mjs';
const ROOT = resolve(PROJECT_ROOT, 'output/reference-facades'), jobs = new Map(), queue = [];
const sourceRevision = createHash('sha256').update((await Promise.all(['src/lib/reference/schema.ts', 'src/lib/reference/reconstruct.ts', 'src/lib/reference/comparison.ts', 'blender/reference_facade.py', 'server/providers/reference-vision.mjs'].map(name => readFile(resolve(PROJECT_ROOT, name), 'utf8')))).join('\n')).digest('hex');
let active = false;
export const referenceDigest = v => createHash('sha256').update(JSON.stringify(v)).digest('hex');
const ID = /^[a-f0-9]{64}$/;
const requestSchema = z.object({ kind: z.enum(['analysis', 'reconstruct', 'refine', 'export']), design: z.unknown().optional(), spec: z.unknown().optional(), settings: referenceSettingsSchema.optional(), imageId: z.string().regex(ID).optional(), analysisImageId: z.string().regex(ID).optional(), crop: imageRectSchema.optional(), cameraView: z.enum(['front', 'left-oblique', 'right-oblique', 'unknown']).optional(), acceptedUrl: z.string().max(250).optional(), quality: z.enum(['preview', 'final']).default('preview') }).strict();
export function validateReferenceDesign(design) {
    if (!design || typeof design !== 'object' || !Array.isArray(design.floors) || design.floors.length < 1 || design.floors.length > 4)
        throw new Error('Open a validated one-to-four-floor house first.');
    let nodes = 0;
    const inspect = v => { if (++nodes > 200000)
        throw new Error('Source plan is too large'); if (typeof v === 'number' && !Number.isFinite(v))
        throw new Error('Source plan contains invalid coordinates'); if (Array.isArray(v)) {
        if (v.length > 3000)
            throw new Error('Source plan array is too large');
        v.forEach(inspect);
    }
    else if (v && typeof v === 'object')
        Object.values(v).forEach(inspect); };
    inspect(design);
    briefSchema.parse(design.model?.brief);
    for (const f of design.floors)
        if (!Array.isArray(f.walls) || f.walls.length > 500 || !Array.isArray(f.openings) || f.openings.length > 500 || !Array.isArray(f.rooms) || f.rooms.length > 150)
            throw new Error('Unsupported source floor geometry');
    if (!validate(design).hardChecksPass)
        throw new Error('The source 2D plan has unresolved mandatory checks. Fix it before reconstruction.');
    const b = createBuildingModel(design);
    if (b.plot.widthMm > 100000 || b.plot.depthMm > 100000)
        throw new Error('Source plot exceeds supported dimensions');
    return b;
}
export async function acceptedReferenceSource(url, planId) {
    if (!url)
        return null;
    const match = /^\/api\/villas\/([a-f0-9-]{36})\/files\/([\w-]+\.glb)$/.exec(url);
    if (!match)
        throw new Error('Choose the current accepted villa; arbitrary model paths are not accepted.');
    const root = await realpath(resolve(PROJECT_ROOT, 'output/villa-jobs')), record = JSON.parse(await readFile(resolve(root, match[1], 'accepted.json'), 'utf8'));
    if (record.planId !== planId || !record.files.includes(match[2]))
        throw new Error('The accepted Blender villa belongs to a different source plan.');
    const path = await realpath(resolve(record.directory, match[2]));
    if (!path.startsWith(root + sep))
        throw new Error('Invalid accepted model location');
    return path;
}
const publicJob = j => ({ id: j.id, kind: j.kind, status: j.status, stage: j.stage, error: j.error, result: j.result });
export async function requestReferenceJob(payload) {
    const p = requestSchema.parse(payload);
    if (p.kind === 'analysis') {
        const image = await readReferenceImage(p.imageId), crop = p.crop ?? { u: 0, v: 0, w: 1, h: 1 }, input = await readReferenceImage(p.analysisImageId ?? p.imageId);
        if ((crop.w !== 1 || crop.h !== 1 || crop.u !== 0 || crop.v !== 0) && !p.analysisImageId)
            throw new Error('Send the selected facade crop for analysis.');
        const expectedAspect = image.width * crop.w / (image.height * crop.h);
        if (Math.abs(input.width / input.height - expectedAspect) > .025)
            throw new Error('Analysis image does not match the selected crop aspect ratio.');
        p.source = { imageHash: image.id, imageWidth: image.width, imageHeight: image.height, mimeType: image.mimeType, crop, provider: process.env.REFERENCE_VISION_PROVIDER ?? 'gemini-web', cameraView: p.cameraView ?? 'unknown' };
    }
    else {
        p.building = validateReferenceDesign(p.design);
        p.spec = parseReferenceSpec(p.spec);
        p.settings = referenceSettingsSchema.parse(p.settings);
        p.geometry = reconstructFacade(p.building, p.spec, p.settings);
        if (p.kind === 'export' && p.geometry.status === 'rejected')
            throw new Error('Resolve all geometry errors before exporting. The original villa is unchanged.');
        if (p.kind === 'export')
            p.sourcePath = await acceptedReferenceSource(p.acceptedUrl, p.building.planId);
    }
    const sourceHash = p.sourcePath ? createHash('sha256').update(await readFile(p.sourcePath)).digest('hex') : null;
    const id = referenceDigest([REFERENCE_ENGINE_VERSION, sourceRevision, p.kind, p.source ?? null, p.analysisImageId ?? null, p.building?.planId ?? null, p.spec ?? null, p.settings ?? null, p.quality, sourceHash, p.kind === 'analysis' ? [REFERENCE_VISION_PROMPT, process.env.REFERENCE_VISION_PROVIDER, process.env.REFERENCE_VISION_URL, process.env.REFERENCE_VISION_MODEL, process.env.GEMINI_WEB_MODEL] : undefined]);
    try {
        const cached = JSON.parse(await readFile(resolve(ROOT, id, 'result.json'), 'utf8'));
        if (cached.id === id) {
            if (p.kind === 'export')
                for (const file of ['facade.blend', 'facade.glb', 'facade.png', 'facade.json'])
                    if ((await stat(resolve(ROOT, id, file))).size < 100)
                        throw new Error('Incomplete cached export');
            return { ...cached, status: 'ready', stage: 'Ready' };
        }
    }
    catch { /* no complete cache */ }
    const existing = jobs.get(id);
    if (existing && !['failed', 'cancelled'].includes(existing.status))
        return publicJob(existing);
    if (queue.length >= 6)
        throw new Error('Reference jobs are busy. Retry after a running job completes.');
    if (jobs.size > 100)
        for (const [key, j] of jobs)
            if (['ready', 'failed', 'cancelled'].includes(j.status)) {
                jobs.delete(key);
                if (jobs.size <= 80)
                    break;
            }
    const job = { id, kind: p.kind, status: 'queued', stage: 'Waiting', controller: new AbortController(), input: p };
    jobs.set(id, job);
    queue.push(job);
    void pump();
    return publicJob(job);
}
async function pump() {
    if (active)
        return;
    active = true;
    while (queue.length) {
        const j = queue.shift();
        if (j.controller.signal.aborted)
            continue;
        const p = j.input, dir = resolve(ROOT, j.id);
        try {
            await mkdir(dir, { recursive: true });
            j.status = 'running';
            if (p.kind === 'analysis') {
                j.stage = 'Reading observed facade geometry';
                const image = await readReferenceImage(p.analysisImageId ?? p.imageId);
                j.result = { spec: await analyzeReferenceVision({ ...image, source: p.source, signal: j.controller.signal }) };
            }
            else if (p.kind === 'refine') {
                j.stage = 'Evaluating bounded validated geometry candidates';
                j.result = refineReference(p.building, p.spec, p.settings, 18);
            }
            else if (p.kind === 'reconstruct') {
                j.stage = 'Validating facade solids and source openings';
                j.result = { spec: p.spec, settings: p.settings, geometry: p.geometry };
            }
            else {
                j.stage = 'Preparing exact source and editable facade objects';
                const base = createBlenderInput(p.design, p.design.dna.seed), { camera, target } = alignedCamera(p.geometry, p.settings, p.spec.source.imageWidth * p.spec.source.crop.w / (p.spec.source.imageHeight * p.spec.source.crop.h));
                const input = { version: 1, identity: j.id, geometry: p.geometry, settings: p.settings, spec: p.spec, base, sourcePath: p.sourcePath, quality: p.quality, camera: { position: camera.position.toArray(), target, focalLengthMm: p.settings.focalLengthMm, aspect: camera.aspect } };
                await writeFile(resolve(dir, 'input.json'), JSON.stringify(input));
                j.stage = 'Exporting with Blender';
                await runBlender(['--input', resolve(dir, 'input.json'), '--out', dir], resolve(dir, 'export.log'), 15 * 60e3, '4', j.controller.signal, 'blender/reference_facade.py');
                const manifest = JSON.parse(await readFile(resolve(dir, 'facade.json'), 'utf8'));
                if (manifest.identity !== j.id || manifest.signature !== p.geometry.signature || !manifest.meshCount)
                    throw new Error('Blender returned an incomplete or different facade export.');
                for (const file of ['facade.blend', 'facade.glb', 'facade.png'])
                    if ((await stat(resolve(dir, file))).size < 100)
                        throw new Error(`Incomplete export: ${file}`);
                j.result = { manifest, files: Object.fromEntries(['facade.blend', 'facade.glb', 'facade.png', 'facade.json'].map(name => [name.split('.').at(-1), `/api/reference/jobs/${j.id}/files/${name}`])) };
            }
            j.controller.signal.throwIfAborted();
            j.status = 'ready';
            j.stage = 'Ready';
            await writeAtomicJson(resolve(dir, 'result.json'), publicJob(j));
        }
        catch (error) {
            j.status = j.controller.signal.aborted ? 'cancelled' : 'failed';
            j.stage = j.status === 'cancelled' ? 'Cancelled' : 'Needs attention';
            j.error = error.name === 'TimeoutError' ? 'Vision analysis timed out. Retry or mark the facade manually.' : error.message?.slice(0, 800) ?? 'Reference operation failed. Your original villa is unchanged.';
        }
        finally {
            delete j.input;
        }
    }
    active = false;
}
export async function handleReferenceFacades(req, res, readJson) {
    const url = new URL(req.url, 'http://localhost');
    if (!url.pathname.startsWith('/api/reference/'))
        return false;
    const send = (code, value) => { res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(value)); };
    try {
        if (url.pathname === '/api/reference/health' && req.method === 'GET') {
            send(200, await referenceVisionHealth());
            return true;
        }
        if (url.pathname === '/api/reference/images' && req.method === 'POST') {
            const p = await readJson(req, 11e6);
            send(201, await storeReferenceImage(p.imageBase64, p.mimeType));
            return true;
        }
        const image = /^\/api\/reference\/images\/([a-f0-9]{64})$/.exec(url.pathname);
        if (image && req.method === 'GET') {
            const v = await readReferenceImage(image[1]);
            res.writeHead(200, { 'content-type': v.mimeType, 'content-length': v.bytes.length, 'cache-control': 'private,max-age=31536000,immutable', 'x-content-type-options': 'nosniff' });
            res.end(v.bytes);
            return true;
        }
        if (url.pathname === '/api/reference/jobs' && req.method === 'POST') {
            const j = await requestReferenceJob(await readJson(req, 14e6));
            send(j.status === 'ready' ? 200 : 202, j);
            return true;
        }
        const job = /^\/api\/reference\/jobs\/([a-f0-9]{64})(?:\/(cancel|files\/(facade\.(?:blend|glb|png|json))))?$/.exec(url.pathname);
        if (job) {
            const [, id, operation, file] = job;
            if (operation === 'cancel' && req.method === 'POST') {
                const j = jobs.get(id);
                if (j && !['ready', 'failed', 'cancelled'].includes(j.status)) {
                    j.controller.abort();
                    j.status = 'cancelled';
                    j.stage = 'Cancelled';
                }
                send(200, { id, status: j?.status ?? 'missing' });
                return true;
            }
            if (file && req.method === 'GET') {
                const result = JSON.parse(await readFile(resolve(ROOT, id, 'result.json'), 'utf8'));
                if (result.status !== 'ready' || result.kind !== 'export')
                    throw new Error('The export is not complete');
                const name = resolve(ROOT, id, file), info = await stat(name);
                res.writeHead(200, { 'content-type': file.endsWith('.png') ? 'image/png' : file.endsWith('.json') ? 'application/json' : file.endsWith('.glb') ? 'model/gltf-binary' : 'application/octet-stream', 'content-length': info.size, 'content-disposition': `attachment; filename="${file}"`, 'x-content-type-options': 'nosniff' });
                createReadStream(name).pipe(res);
                return true;
            }
            if (!operation && req.method === 'GET') {
                const j = jobs.get(id);
                if (j)
                    send(200, publicJob(j));
                else {
                    try {
                        send(200, JSON.parse(await readFile(resolve(ROOT, id, 'result.json'), 'utf8')));
                    }
                    catch {
                        send(404, { error: 'This job is unavailable. Retry with the saved geometry specification.' });
                    }
                }
            }
            else
                send(405, { error: 'Unsupported reference operation' });
            return true;
        }
        send(404, { error: 'Unknown reference endpoint' });
    }
    catch (error) {
        send(error.code === 'ENOENT' ? 404 : 400, { error: error instanceof z.ZodError ? error.issues.map(i => i.message).slice(0, 4).join('; ') : String(error.message ?? 'Reference request failed').slice(0, 800) });
    }
    return true;
}
