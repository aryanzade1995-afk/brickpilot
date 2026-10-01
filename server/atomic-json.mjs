import { writeFile, rename } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'

/** Windows readers/antivirus can briefly prevent replacing a progress file. */
export async function writeAtomicJson(path, value, { replace = rename, pause = delay } = {}) {
  const temporary = `${path}.tmp`
  await writeFile(temporary, JSON.stringify(value))
  for (let attempt = 0; ; attempt++) {
    try { await replace(temporary, path); return }
    catch (error) {
      if (!['EPERM', 'EBUSY', 'EACCES'].includes(error.code) || attempt >= 9) throw error
      await pause(25 * (attempt + 1))
    }
  }
}
