/* Run the Vite dev server and the render proxy together. Zero dependencies. */
import { spawn } from 'node:child_process'

const opts = { stdio: 'inherit', shell: true }
const web = spawn('vite', [], opts)
const api = spawn('node', ['server/index.mjs'], opts)

let down = false
const stop = (code = 0) => {
  if (down) return
  down = true
  web.kill()
  api.kill()
  process.exit(code)
}

process.on('SIGINT', () => stop(0))
process.on('SIGTERM', () => stop(0))
web.on('exit', (c) => stop(c ?? 0))
api.on('exit', (c) => stop(c ?? 0))
