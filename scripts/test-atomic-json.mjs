import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp, readFile, writeFile, rename, unlink, rmdir} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {writeAtomicJson} from '../server/atomic-json.mjs'
async function clean(folder, path) {
  await Promise.all([unlink(path).catch(() => {}), unlink(path + '.tmp').catch(() => {})])
  await rmdir(folder)
}

test('a transient Windows sharing lock does not abort Blender progress or truncate the last status', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'villa-status-')), path = join(folder, 'status.json')
  const previous = {status: 'generating'}, next = {status: 'rendering', attempt: 3}
  await writeFile(path, JSON.stringify(previous))
  let replacements = 0
  try {
    await writeAtomicJson(path, next, {pause: async () => {}, replace: async (from, to) => {
      if (++replacements < 3) {
        assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), previous)
        throw Object.assign(new Error('Sharing lock'), {code: 'EPERM'})
      }
      await rename(from, to)
    }})
    assert.equal(replacements, 3)
    assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), next)
  } finally { await clean(folder, path) }
})

test('permanent progress-write errors are bounded and reported', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'villa-status-')), path = join(folder, 'status.json')
  let attempts = 0
  try {
    await assert.rejects(writeAtomicJson(path, {}, {pause: async () => {}, replace: async () => {
      attempts++; throw Object.assign(new Error('Locked'), {code: 'EBUSY'})
    }}), /Locked/)
    assert.equal(attempts, 10)
  } finally { await clean(folder, path) }
})
