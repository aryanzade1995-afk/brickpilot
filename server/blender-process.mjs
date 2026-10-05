import { spawn } from 'node:child_process'
import { existsSync, readdirSync, createWriteStream } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { availableParallelism } from 'node:os'
import { fileURLToPath } from 'node:url'

export const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export function blenderExecutable() {
  if (process.env.BLENDER_BIN) return process.env.BLENDER_BIN
  const tools = resolve(PROJECT_ROOT, 'output/tools'), executable = process.platform === 'win32' ? 'blender.exe' : 'blender'
  return existsSync(tools) ? readdirSync(tools).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
    .filter((name) => name.startsWith('blender-')).map((name) => resolve(tools, name, executable))
    .find((path) => existsSync(path)) || 'blender' : 'blender'
}
/** CPU threads for one Blender process: VILLA_BLENDER_THREADS, else every core */
export const blenderThreads = () => process.env.VILLA_BLENDER_THREADS || String(availableParallelism())

export function runBlender(args, logPath, timeoutMs = 90 * 60 * 1000, threads = blenderThreads(), signal = undefined, script = 'blender/generator.py', onOutput = undefined, runtime = {}) {
  return new Promise((accept, reject) => {
    const log = createWriteStream(logPath, { flags: 'a' })
    const child = spawn(blenderExecutable(), ['-b', '--factory-startup', '--threads', String(threads), ...(runtime.fallback ? ['--gpu-backend','opengl'] : []),
      '--python-exit-code', '1', '--python', resolve(PROJECT_ROOT, script), '--', ...args],
    // signal: a parallel candidate no longer needed is stopped, not waited for
    { cwd: PROJECT_ROOT, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], ...(runtime.fallback && process.platform === 'linux' ? {env:{...process.env,LIBGL_ALWAYS_SOFTWARE:'1'}} : {}), ...(signal ? { signal } : {}) })
    child.stdout.pipe(log, { end: false }); child.stderr.pipe(log, { end: false })
    if (onOutput) child.stdout.on('data', chunk => onOutput(chunk.toString()))
    const timer = setTimeout(() => { child.kill(); reject(new Error('Blender generation timed out; previous design is retained')) }, timeoutMs)
    child.on('error', (error) => { clearTimeout(timer); log.end(); reject(new Error(`Blender could not start: ${error.message}`)) })
    child.on('exit', (code) => { clearTimeout(timer); log.end(); if (code === 0) accept(); else reject(new Error(`Blender failed (${code}); see generation log`)) })
  })
}
