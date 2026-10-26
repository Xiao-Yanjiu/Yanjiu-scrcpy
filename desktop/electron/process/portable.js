import path from 'node:path'
import fs from 'node:fs'
import { app } from 'electron'

/**
 * Setup Electron portable mode by redirecting data directories
 */
export function setupPortableMode() {
  if (process.platform !== 'win32') {
    return false
  }

  const sourceRoot = process.env.YANJIU_SOURCE_ROOT
  const executableDir = path.dirname(process.execPath)
  const portableDir = process.env.PORTABLE_EXECUTABLE_DIR
    || (!sourceRoot && fs.existsSync(path.join(executableDir, '.portable')) ? executableDir : undefined)

  if (!sourceRoot && !portableDir) {
    return false
  }

  const dataRoot = sourceRoot ? path.resolve(sourceRoot, 'user-data') : path.resolve(portableDir, 'Data')

  const paths = {
    userData: sourceRoot ? dataRoot : path.join(dataRoot, 'profile'),
    sessionData: path.join(dataRoot, 'session'),
    cache: path.join(dataRoot, 'cache'),
    logs: path.join(dataRoot, 'logs'),
  }

  for (const dir of Object.values(paths)) {
    fs.mkdirSync(dir, { recursive: true })
  }

  for (const [key, value] of Object.entries(paths)) {
    app.setPath(key, value)
  }

  return true
}
