import { execSync } from 'node:child_process'

/**
 * Resolve the Electron download mirror from the user's npm config, so
 * `electronDownload.mirror` follows the same mirror setting the rest of the
 * toolchain (npm/pnpm) already uses. Returns undefined when no mirror is
 * configured, letting electron-builder fall back to the official source.
 */
export function resolveElectronMirror() {
  if (process.env.ELECTRON_MIRROR)
    return process.env.ELECTRON_MIRROR
  try {
    const raw = execSync('npm config get electron_mirror', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
    return (raw && raw !== 'undefined') ? raw : undefined
  }
  catch {
    return undefined
  }
}
