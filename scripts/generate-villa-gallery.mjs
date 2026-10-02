import { spawn } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { generateAlternativeDesign } from '../src/lib/engine/generateAlternativeDesign.ts'
import { defaultBrief } from '../src/lib/model/brief.ts'
import { compile } from '../src/lib/model/canonical.ts'
import { generate } from '../src/lib/engine/generate.ts'
import { PROJECT_ROOT, blenderExecutable } from '../server/blender-process.mjs'
import { VILLA_GALLERY_SEEDS, VILLA_GALLERY_DIRECTORY } from './villa-gallery-config.mjs'

const index = process.argv.indexOf('--plan')
if (index >= 0 && !process.argv[index + 1]) throw new Error('--plan requires an existing Design JSON path')
// The default is an explicit diagnostic fixture, generated once. Supplying a
// saved plan never calls the planner and never changes the user's app state.
const fixture=defaultBrief();fixture.site.plotWidth=24;fixture.site.plotDepth=30
const plan = index >= 0 ? JSON.parse(await readFile(resolve(process.argv[index + 1]), 'utf8'))
  : generate(compile(fixture), { massing:'u-wing',seed: 41 })
const input = resolve(PROJECT_ROOT, 'output/gallery-inputs'), output = resolve(PROJECT_ROOT, VILLA_GALLERY_DIRECTORY)
await mkdir(input, { recursive: true })
await writeFile(resolve(input, 'plan.json'), JSON.stringify(plan))
for (let seed = 1; seed <= VILLA_GALLERY_SEEDS; seed++) await writeFile(resolve(input, `villa_${seed}.json`), JSON.stringify(generateAlternativeDesign(plan, seed)))
const child = spawn(blenderExecutable(), ['-b', '--factory-startup', '--threads', '4', '--python-exit-code', '1',
  '--python', resolve(PROJECT_ROOT, 'blender/gallery.py'), '--', '--inputs', input, '--out-dir', output,'--end',String(VILLA_GALLERY_SEEDS)],
{ cwd: PROJECT_ROOT, shell: false, windowsHide: true, stdio: 'inherit' })
await new Promise((accept, reject) => { child.on('error', reject); child.on('exit', (code) => code === 0 ? accept() : reject(new Error(`Gallery Blender export failed (${code})`))) })
await import('./build-villa-gallery.mjs')
