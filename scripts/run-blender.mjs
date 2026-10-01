import { spawn } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'

const arg = (flag, fallback) => {
  const index = process.argv.indexOf(flag)
  return index < 0 ? fallback : process.argv[index + 1]
}
const toolsDir = resolve('output/tools')
const executable = process.platform === 'win32' ? 'blender.exe' : 'blender'
const localBlender = existsSync(toolsDir)
  ? readdirSync(toolsDir).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
    .filter((name) => name.startsWith('blender-'))
    .map((name) => resolve(toolsDir, name, executable)).find((path) => existsSync(path))
  : undefined
const blender = arg('--blender', process.env.BLENDER_BIN || localBlender || 'blender')
const input = resolve(arg('--input', 'output/blender-input.json'))
const output = resolve(arg('--out-dir', 'output/villa'))
const name = arg('--name', 'villa')
if (!/^[a-zA-Z0-9_-]+$/.test(name)) throw new Error('--name must use letters, digits, _ or -')
const args = ['-b', '--factory-startup', '--python-exit-code', '1', '--python', resolve('blender/generator.py'), '--',
  '--input', input, '--out-dir', output, '--name', name]
if (process.argv.includes('--render')) args.push('--render')
if (process.argv.includes('--render-all')) args.push('--render-all')
for (const flag of ['--palette', '--engine', '--quality', '--camera', '--samples', '--resolution', '--lighting', '--hdri', '--visualization']) {
  const value = arg(flag, undefined)
  if (process.argv.includes(flag) && value === undefined) throw new Error(`${flag} requires a value`)
  if (value !== undefined) args.push(flag, ['--hdri', '--visualization'].includes(flag) ? resolve(value) : value)
}
const child = spawn(blender, args, { stdio: 'inherit', shell: false })
child.on('error', (error) => {
  process.stderr.write(`Could not start Blender (${blender}): ${error.message}\nSet BLENDER_BIN to blender.exe or pass --blender.\n`)
  process.exitCode = 1
})
child.on('exit', (code, signal) => { process.exitCode = code ?? (signal ? 1 : 0) })
