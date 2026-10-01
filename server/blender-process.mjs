import { spawn } from 'node:child_process'
import { existsSync, readdirSync, createWriteStream } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export function blenderExecutable() {
  if (process.env.BLENDER_BIN) return process.env.BLENDER_BIN
  const tools = resolve(PROJECT_ROOT, 'output/tools'), executable = process.platform === 'win32' ? 'blender.exe' : 'blender'
  return existsSync(tools) ? readdirSync(tools).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
    .filter((name) => name.startsWith('blender-')).map((name) => resolve(tools, name, executable))
    .find((path) => existsSync(path)) || 'blender' : 'blender'
}
export function runBlender(args, logPath, timeoutMs = 90 * 60 * 1000) {
  return new Promise((accept, reject) => {
    const log = createWriteStream(logPath, { flags: 'a' })
    const child = spawn(blenderExecutable(), ['-b', '--factory-startup', '--threads', process.env.VILLA_BLENDER_THREADS || '4',
      '--python-exit-code', '1', '--python', resolve(PROJECT_ROOT, 'blender/generator.py'), '--', ...args],
    { cwd: PROJECT_ROOT, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    child.stdout.pipe(log, { end: false }); child.stderr.pipe(log, { end: false })
    const timer = setTimeout(() => { child.kill(); reject(new Error('Blender generation timed out; previous design is retained')) }, timeoutMs)
    child.on('error', (error) => { clearTimeout(timer); log.end(); reject(new Error(`Blender could not start: ${error.message}`)) })
    child.on('exit', (code) => { clearTimeout(timer); log.end(); if (code === 0) accept(); else reject(new Error(`Blender failed (${code}); see generation log`)) })
  })
}
