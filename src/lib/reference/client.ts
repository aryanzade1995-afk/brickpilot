import type { ReferenceFacadeSpec } from './schema.ts';
export type ReferenceJob = {
    id: string;
    kind: string;
    status: 'queued' | 'running' | 'ready' | 'failed' | 'cancelled';
    stage: string;
    error?: string;
    result?: Record<string, unknown>;
};
export async function referenceRequest<T>(url: string, body?: unknown, signal?: AbortSignal): Promise<T> { const r = await fetch(url, { ...(body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }), signal }); const v = await r.json(); if (!r.ok)
    throw new Error(v.error ?? 'Reference service is unavailable.'); return v; }
export async function runReferenceJob(payload: unknown, onProgress: (job: ReferenceJob) => void, signal: AbortSignal) {
    let j = await referenceRequest<ReferenceJob>('/api/reference/jobs', payload, signal);
    onProgress(j);
    const cancel = () => { void referenceRequest(`/api/reference/jobs/${j.id}/cancel`, {}).catch(() => { }); };
    signal.addEventListener('abort', cancel, { once: true });
    try {
        while (j.status === 'queued' || j.status === 'running') {
            await new Promise<void>((resolve, reject) => { const done = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); }, timer = setTimeout(() => { done(); resolve(); }, 1000), abort = () => { done(); reject(new DOMException('Cancelled', 'AbortError')); }; signal.addEventListener('abort', abort, { once: true }); if (signal.aborted)
                abort(); });
            j = await referenceRequest<ReferenceJob>(`/api/reference/jobs/${j.id}`, undefined, signal);
            onProgress(j);
        }
        if (j.status !== 'ready')
            throw new Error(j.error ?? 'Operation cancelled. Your original design is unchanged.');
        return j.result!;
    }
    finally {
        signal.removeEventListener('abort', cancel);
    }
}
export function loadReferenceImage(url: string): Promise<HTMLImageElement> { return new Promise((resolve, reject) => { const img = new Image(); img.onload = () => resolve(img); img.onerror = () => reject(new Error('The reference image is unavailable. Upload it again; saved geometry is retained.')); img.src = url; }); }
export async function uploadReference(file: File) {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type))
        throw new Error('Choose a JPEG, PNG or WebP photograph.');
    if (file.size > 8 * 1024 * 1024)
        throw new Error('Use an image smaller than 8 MB.');
    const url = URL.createObjectURL(file);
    try {
        const image = await loadReferenceImage(url);
        if (image.naturalWidth < 64 || image.naturalHeight < 64 || image.naturalWidth * image.naturalHeight > 16000000)
            throw new Error('Use an image at least 64 × 64 pixels and below 16 megapixels.');
        if(image.naturalWidth/image.naturalHeight<.25||image.naturalWidth/image.naturalHeight>10)
            throw new Error('Crop very tall images or wide panoramas first. Supported photograph proportions are between 1:4 and 10:1.');
        const c = document.createElement('canvas'), scale = Math.min(1, 2048 / Math.max(image.naturalWidth, image.naturalHeight));
        c.width = Math.round(image.naturalWidth * scale);
        c.height = Math.round(image.naturalHeight * scale);
        c.getContext('2d')!.drawImage(image, 0, 0, c.width, c.height);
        return await referenceRequest<{
            id: string;
            width: number;
            height: number;
            mimeType: ReferenceFacadeSpec['source']['mimeType'];
        }>('/api/reference/images', { imageBase64: c.toDataURL('image/png').split(',')[1], mimeType: 'image/png' });
    }
    finally {
        URL.revokeObjectURL(url);
    }
}
export async function uploadCrop(spec: ReferenceFacadeSpec) { const img = await loadReferenceImage(`/api/reference/images/${spec.source.imageHash}`), r = spec.source.crop, c = document.createElement('canvas'); c.width = Math.round(img.naturalWidth * r.w); c.height = Math.round(img.naturalHeight * r.h); if (Math.min(c.width, c.height) < 64)
    throw new Error('Select a facade crop at least 64 pixels wide and tall.'); c.getContext('2d')!.drawImage(img, img.naturalWidth * r.u, img.naturalHeight * r.v, c.width, c.height, 0, 0, c.width, c.height); return referenceRequest<{
    id: string;
}>('/api/reference/images', { imageBase64: c.toDataURL('image/png').split(',')[1], mimeType: 'image/png' }); }
