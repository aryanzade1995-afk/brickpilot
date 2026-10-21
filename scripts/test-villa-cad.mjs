import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, dirname } from 'node:path'
import { prepareCadExport, CAD_EXPORT_VERSION, handleCadExport } from '../server/villa-cad.mjs'

const id = '12345678-1234-1234-1234-123456789abc'
async function fixture(t, scope = 'building-only') {
  const root = await mkdtemp(resolve(tmpdir(), 'formstead-cad-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const directory = resolve(root, id), master = resolve(directory, 'accepted', 'villa.blend')
  await mkdir(dirname(master), { recursive: true }); await writeFile(master, 'immutable accepted master')
  const accepted = { seed: 42, planId: 'saved-plan', files: ['villa.blend'], directory: dirname(master), artifactScope: scope }
  await writeFile(resolve(directory, 'accepted.json'), JSON.stringify(accepted))
  let calls = 0
  const convert = async (args, log, timeout, threads, signal, script) => {
    calls++
    assert.equal(args[args.indexOf('--source') + 1], master)
    assert.equal(script, 'blender/cad_export.py')
    assert.equal(args[args.indexOf('--scope') + 1], scope)
    const out = args[args.indexOf('--output') + 1]
    for (const ext of ['dxf', 'dae']) await writeFile(resolve(out, `villa-${scope}.${ext}`), `mesh:${ext}`)
    await writeFile(resolve(out, 'manifest.json'), JSON.stringify({ exportVersion: CAD_EXPORT_VERSION, triangleCount: 12 }))
  }
  return { root, directory, master, accepted, convert, calls: () => calls }
}

test('both formats share one accepted-only conversion and reuse cache without modifying the master', async t => {
  const f = await fixture(t), original = await readFile(f.master)
  const [dxf, dae] = await Promise.all(['dxf', 'dae'].map(ext => prepareCadExport(id, ext, f)))
  assert.equal(f.calls(), 1)
  assert.equal(dxf.filename, 'villa-building-only.dxf'); assert.equal(dae.contentType, 'model/vnd.collada+xml')
  await prepareCadExport(id, 'dxf', f); assert.equal(f.calls(), 1)
  assert.deepEqual(await readFile(f.master), original)
  const stamp = (await stat(f.master)).mtimeMs
  assert.ok(stamp > 0)
})

test('combined solar master has distinct scope and changed accepted source invalidates cache', async t => {
  const f = await fixture(t, 'building-plus-solar')
  const first = await prepareCadExport(id, 'dae', f)
  assert.equal(first.filename, 'villa-building-plus-solar.dae')
  await writeFile(f.master, 'another accepted master with canonical panels')
  const second = await prepareCadExport(id, 'dae', f)
  assert.notEqual(first.path, second.path); assert.equal(f.calls(), 2)
})

test('failed conversion publishes no partial artifact and can retry', async t => {
  const f = await fixture(t)
  await assert.rejects(prepareCadExport(id, 'dxf', { ...f, convert: async () => { throw new Error('test failure') } }), /test failure/)
  assert.ok((await prepareCadExport(id, 'dxf', f)).path.endsWith('.dxf'))
})

test('unsupported formats, unsafe job identifiers and masters outside the job are rejected', async t => {
  const f = await fixture(t)
  for (const [job, format] of [[id, 'skp'], [id, 'dwg'], ['../bad', 'dxf']])
    await assert.rejects(prepareCadExport(job, format, f), /Unsupported/)
  await writeFile(resolve(f.root, 'outside.blend'), 'outside')
  await writeFile(resolve(f.directory, 'accepted.json'), JSON.stringify({ ...f.accepted, files: ['outside.blend'], directory: f.root }))
  await assert.rejects(prepareCadExport(id, 'dxf', f), /outside its villa job/)
  assert.equal(f.calls(), 0)
})

test('CAD route leaves existing villa endpoints alone and rejects wrong methods', async () => {
  assert.equal(await handleCadExport({ url: `/api/villas/${id}`, method: 'GET' }, {}), false)
  const response = { writeHead(code) { this.code = code }, end() {} }
  assert.equal(await handleCadExport({ url: `/api/villas/${id}/cad/dxf`, method: 'POST' }, response), true)
  assert.equal(response.code, 405)
})
