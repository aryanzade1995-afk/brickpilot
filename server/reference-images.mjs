import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { PROJECT_ROOT } from './blender-process.mjs';
const ROOT = resolve(PROJECT_ROOT, 'output/reference-facades/images');
export const imageIdPattern = /^[a-f0-9]{64}$/;
export function inspectReferenceImage(base64, mime) {
    if (typeof base64 !== 'string' || base64.length > 11e6 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64) || base64.length % 4)
        throw new Error('Choose a JPEG, PNG or WebP image under 8 MB.');
    const bytes = Buffer.from(base64, 'base64');
    if (bytes.length < 32 || bytes.length > 8e6)
        throw new Error('Image size must be between 32 bytes and 8 MB.');
    let width, height, actual;
    if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
        actual = 'image/png';
        if (bytes.toString('ascii', 12, 16) !== 'IHDR' || bytes.readUInt32BE(8) !== 13)
            throw new Error('Invalid PNG header');
        width = bytes.readUInt32BE(16);
        height = bytes.readUInt32BE(20);
        let at = 8, idat = false, ended = false;
        while (at + 12 <= bytes.length) {
            const length = bytes.readUInt32BE(at);
            if (length > bytes.length - at - 12)
                throw new Error('Truncated PNG image');
            const type = bytes.toString('ascii', at + 4, at + 8);
            idat ||= type === 'IDAT';
            at += length + 12;
            if (type === 'IEND') {
                ended = at === bytes.length;
                break;
            }
        }
        if (!idat || !ended)
            throw new Error('Incomplete PNG image');
    }
    else if (bytes[0] === 255 && bytes[1] === 216) {
        actual = 'image/jpeg';
        if (bytes.at(-2) !== 255 || bytes.at(-1) !== 217)
            throw new Error('Truncated JPEG image');
        let at = 2;
        while (at + 4 < bytes.length) {
            if (bytes[at++] !== 255)
                continue;
            while (bytes[at] === 255)
                at++;
            const marker = bytes[at++];
            if (marker === 0xda)
                break;
            if (marker === 0x01 || marker >= 0xd0 && marker <= 0xd9)
                continue;
            const length = bytes.readUInt16BE(at);
            if (length < 2 || at + length > bytes.length)
                throw new Error('Invalid JPEG segment');
            if ([0xc0, 0xc1, 0xc2].includes(marker)) {
                height = bytes.readUInt16BE(at + 3);
                width = bytes.readUInt16BE(at + 5);
                break;
            }
            at += length;
        }
    }
    else if (bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') {
        actual = 'image/webp';
        if (bytes.readUInt32LE(4) + 8 !== bytes.length)
            throw new Error('Incomplete WebP image');
        const kind = bytes.toString('ascii', 12, 16);
        if (kind === 'VP8X') {
            width = bytes.readUIntLE(24, 3) + 1;
            height = bytes.readUIntLE(27, 3) + 1;
        }
        else if (kind === 'VP8L' && bytes[20] === 0x2f) {
            const bits = bytes.readUInt32LE(21);
            width = (bits & 0x3fff) + 1;
            height = ((bits >>> 14) & 0x3fff) + 1;
        }
        else if (kind === 'VP8 ' && bytes[23] === 0x9d && bytes[24] === 1 && bytes[25] === 0x2a) {
            width = bytes.readUInt16LE(26) & 0x3fff;
            height = bytes.readUInt16LE(28) & 0x3fff;
        }
    }
    if (actual !== mime || !width || !height || width < 64 || height < 64 || width > 8192 || height > 8192 || width * height > 16e6)
        throw new Error('Use a genuine JPEG, PNG or WebP image, 64–8192 pixels per side, up to 16 megapixels.');
    return { bytes, width, height, mimeType: actual, id: createHash('sha256').update(bytes).digest('hex') };
}
export async function storeReferenceImage(base64, mime) { const image = inspectReferenceImage(base64, mime); await mkdir(ROOT, { recursive: true }); await writeFile(resolve(ROOT, image.id + '.image'), image.bytes); const metadata = { id: image.id, width: image.width, height: image.height, mimeType: image.mimeType }; await writeFile(resolve(ROOT, image.id + '.json'), JSON.stringify(metadata)); return { ...metadata, url: `/api/reference/images/${image.id}` }; }
export async function readReferenceImage(id) { if (!imageIdPattern.test(id ?? ''))
    throw new Error('Invalid stored image ID'); const metadata = JSON.parse(await readFile(resolve(ROOT, id + '.json'), 'utf8')), bytes = await readFile(resolve(ROOT, id + '.image')); if (createHash('sha256').update(bytes).digest('hex') !== id)
    throw new Error('Stored reference bytes changed'); return { ...metadata, bytes }; }
