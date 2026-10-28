import { delimiter, dirname, resolve } from 'node:path'
import { existsSync } from 'node:fs'
import which from 'which'

export const PLATFORM_MAP = Object.freeze({
  win32: 'win',
  darwin: 'mac',
  linux: 'linux',
})

export function extraResolve(filePath) {
  const isProduction = process.env.IS_PACKAGED === 'true'

  const basePath = isProduction ? process.resourcesPath : 'electron/resources'

  const value = resolve(basePath, 'extra', filePath)

  return value
}

export function buildResolve(value) {
  return process.env.IS_PACKAGED === 'true'
    ? resolve(process.resourcesPath, 'build', value)
    : resolve('electron/resources/build', value)
}

export function whichResolve(command, dir) {
  const extraDirs = Object.values(getExtraPlatformDirs())
  const filteredDirs = [...new Set([dir, ...extraDirs])]
  const searchPath = [...filteredDirs, process.env.PATH].filter(Boolean).join(delimiter)

  return which.sync(command, { nothrow: true, path: searchPath })
}

/**
 * Compute platform-specific extra directories for adb, scrcpy, and gnirehtet.
 * Shared by which module (dependency resolution) and helper (PATH setup).
 */
export function getExtraPlatformDirs() {
  const platform = PLATFORM_MAP[process.platform]
  const arch = process.arch
  const platformArch = platform === 'win' ? 'win' : `${platform}-${arch}`

  const adjacentScrcpy = resolve(dirname(process.execPath), 'scrcpy')
  const scrcpyBinary = platform === 'win' ? 'scrcpy.exe' : 'scrcpy'
  const scrcpyDir = process.env.IS_PACKAGED === 'true' && ['win', 'linux'].includes(platform)
    && existsSync(resolve(adjacentScrcpy, scrcpyBinary))
    ? adjacentScrcpy
    : extraResolve(`${platformArch}/scrcpy`)

  return {
    adb: scrcpyDir,
    scrcpy: scrcpyDir,
    gnirehtet: extraResolve(`${platformArch}/gnirehtet`),
  }
}
