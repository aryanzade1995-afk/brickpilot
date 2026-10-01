import assert from 'node:assert/strict'
import test from 'node:test'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, readFile, writeFile, readdir, unlink, rmdir } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { defaultBrief } from '../src/lib/model/brief.ts'
import { compile } from '../src/lib/model/canonical.ts'
import { generate } from '../src/lib/engine/generate.ts'

const execute = promisify(execFile)
test('CLI persists accepted shapes, retries duplicates, preserves files on exhaustion and supports exact replay', async () => {
  const directory = await mkdtemp(resolve('output/fingerprint-cli-'))
  const source = join(directory, 'source.json'), output = join(directory, 'input.json'), history = join(directory, 'history.json')
  const command = ['--experimental-strip-types', 'scripts/export-blender-input.mjs', '--design', source,
    '--out', output, '--history', history]
  try {
    await writeFile(source, JSON.stringify(generate(compile(defaultBrief()))))
    const first = await execute(process.execPath, [...command, '--seed', '41'])
    assert.match(first.stdout, /seed=41 .*ACCEPTED/)
    const initial = JSON.parse(await readFile(output, 'utf8'))
    assert.equal(JSON.parse(await readFile(history, 'utf8')).length, 1)
    const second = await execute(process.execPath, [...command, '--seed', '42'])
    assert.match(second.stdout, /seed=42 .*nearestPreviousSeed=41 .*REJECTED/)
    assert.match(second.stdout, /ACCEPTED/)
    const next = JSON.parse(await readFile(output, 'utf8'))
    assert.notEqual(next.villaDesignDNA.seed, 42)
    assert.deepEqual(next.buildingModel, initial.buildingModel)
    assert.equal(JSON.parse(await readFile(history, 'utf8')).length, 2)
    const outputBefore = await readFile(output, 'utf8'), historyBefore = await readFile(history, 'utf8')
    await assert.rejects(execute(process.execPath, [...command, '--seed', '43', '--max-attempts', '2', '--similarity-threshold', '0']),
      (error) => error.code === 1 && error.stderr.includes('existing output and history preserved'))
    assert.equal(await readFile(output, 'utf8'), outputBefore)
    assert.equal(await readFile(history, 'utf8'), historyBefore)
    const replay = await execute(process.execPath, [...command, '--seed', '41', '--exact-seed'])
    assert.match(replay.stdout, /Exact seed replay/)
    assert.deepEqual(JSON.parse(await readFile(output, 'utf8')).shapeFingerprint, initial.shapeFingerprint)
    assert.equal(await readFile(history, 'utf8'), historyBefore)
    assert.ok(!(await readdir(directory)).some((name) => name.endsWith('.lock')))
  } finally {
    // Remove only files in this freshly created test directory, then its empty directory.
    for (const name of await readdir(directory)) await unlink(join(directory, name))
    await rmdir(directory)
  }
})
