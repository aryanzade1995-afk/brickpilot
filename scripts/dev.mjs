/*
 * Run the Vite dev server and the render proxy together. Zero dependencies.
 * Both are spawned as plain Node processes (no shell) so it behaves the same
 * on every OS. Ctrl-C stops both; if one exits the other is left running.
 */
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

const require = createRequire(import.meta.url)
const viteBin = join(dirname(require.resolve('vite/package.json')), 'bin/vite.js')

const web = spawn(process.execPath, [viteBin], { stdio: 'inherit' })
const api = spawn(process.execPath, ['server/index.mjs'], { stdio: 'inherit' })

const stop = () => {
  web.kill()
  api.kill()
}
process.on('SIGINT', () => {
  stop()
  process.exit(0)
})
process.on('SIGTERM', () => {
  stop()
  process.exit(0)
})

web.on('exit', (code) => {
  console.error(`[dev] vite exited (${code}); proxy still on :8787`)
})
api.on('exit', (code) => {
  console.error(`[dev] render proxy exited (${code}); vite still on :3000`)
})
