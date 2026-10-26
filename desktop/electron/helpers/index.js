import { join } from 'node:path'
import { Buffer } from 'node:buffer'
import { nativeTheme } from 'electron'
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { extraResolve } from '$electron/process/resources.js'
import { cloneDeep, isEmpty, omitBy } from 'lodash-es'

/**
 * Safe deep clone function to avoid stack overflow from circular references
 * @param {any} value - Value to clone
 * @returns {any} - Cloned value
 */
function safeCloneDeep(value) {
  // Return early for primitive, null, or undefined
  if (value === null || typeof value !== 'object') {
    return value
  }

  // For Error objects, keep basic info to avoid circular references
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack,
    }
  }

  // For other object types, attempt deep clone; return original value on failure
  try {
    return cloneDeep(value)
  }
  catch (error) {
    // If deep clone fails (often due to circular refs), return a shallow copy
    if (error instanceof RangeError) {
      return Array.isArray(value) ? [...value] : { ...value }
    }
    return value
  }
}

/**
 * Create a proxy object that forwards specified methods from the target object.
 *
 * @param {object} targetObject - The target object containing methods to proxy.
 * @param {string[]} methodNames - Array of method names to proxy.
 * @returns {object} - Proxy object with forwarded methods.
 */
export function createProxy(targetObject, methodNames) {
  return methodNames.reduce((proxyObj, methodName) => {
    proxyObj[methodName] = (...args) =>
      targetObject[methodName](...args.map(arg => safeCloneDeep(arg)))

    return proxyObj
  }, {})
}

export function isWindowDestroyed(win) {
  return !win || win?.isDestroyed?.()
}

export function loadPage(win, options) {
  const { prefix = '', query, rendererDir = '' } = options || {}

  let stringifyQuery = ''

  if (query) {
    stringifyQuery = typeof query === 'string' ? query : `?${(new URLSearchParams(omitBy(query || {}, isEmpty))).toString()}`
  }

  const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(join(VITE_DEV_SERVER_URL, prefix) + stringifyQuery)
  }
  else {
    win.loadFile(join(rendererDir, prefix, 'index.html'), {
      search: stringifyQuery,
    })
  }
}

export function streamToBase64(stream) {
  return new Promise((resolve, reject) => {
    const chunks = []
    stream.on('data', (chunk) => {
      chunks.push(chunk)
    })
    stream.on('end', () => {
      const buffer = Buffer.concat(chunks)
      resolve(buffer.toString('base64'))
    })
    stream.on('error', (error) => {
      reject(error)
    })
  })
}

export function getAppBackgroundColor() {
  return nativeTheme.shouldUseDarkColors ? '#171717' : '#F5F5F5'
}

export function isPortable() {
  return process.platform === 'win32' && Boolean(process.env.PORTABLE_EXECUTABLE_DIR)
}

export function isPackaged() {
  return process.env.IS_PACKAGED === 'true'
}

export function trySend(sender, channel, ...args) {
  if (!sender.isDestroyed()) {
    try {
      sender.send(channel, ...args)
    }
    catch (error) {
      console.warn(`[Terminal Service] Failed to send ${channel}:`, error.message)
    }
  }
}

let glassBridge
function getGlassBridge() {
  if (glassBridge)
    return glassBridge
  const child = spawn('powershell.exe', ['-NoProfile', '-STA', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', extraResolve('win/desktop-window.ps1'), '-GlassOnly'], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
  const pending = new Map()
  let sequence = 0
  let resolveReady
  let rejectReady
  const ready = new Promise((resolve, reject) => {
    resolveReady = resolve
    rejectReady = reject
  })
  const timeout = setTimeout(() => rejectReady(new Error('原生圆角服务启动超时')), 15000)
  ready.catch(() => {})
  const reader = createInterface({ input: child.stdout })
  let errors = ''
  child.stderr.on('data', data => errors = (errors + data).slice(-2000))
  reader.on('line', (line) => {
    let message
    try {
      message = JSON.parse(line)
    }
    catch { return }
    if (message.ready) {
      clearTimeout(timeout)
      resolveReady()
      return
    }
    const request = pending.get(message.id)
    if (!request)
      return
    pending.delete(message.id)
    clearTimeout(request.timer)
    message.error ? request.reject(new Error(message.error)) : request.resolve(message.result)
  })
  const ended = (error) => {
    clearTimeout(timeout)
    const failure = error || new Error(errors || '原生圆角服务已关闭')
    rejectReady(failure)
    for (const request of pending.values()) {
      clearTimeout(request.timer)
      request.reject(failure)
    }
    pending.clear()
    if (glassBridge?.child === child)
      glassBridge = null
  }
  child.once('error', ended)
  child.once('exit', () => ended())
  glassBridge = {
    child,
    windows: new Set(),
    async request(data) {
      await ready
      if (child.killed || child.exitCode !== null)
        throw new Error('原生圆角服务已关闭')
      const id = ++sequence
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id)
          reject(new Error('原生圆角更新超时'))
        }, 5000)
        pending.set(id, { resolve, reject, timer })
        child.stdin.write(`${JSON.stringify({ ...data, id })}\n`)
      })
    },
  }
  return glassBridge
}

export async function attachRoundedGlass(win, preferences) {
  if (process.platform !== 'win32')
    return
  win.roundedGlass = true
  win.setBackgroundMaterial('none')
  win.setBackgroundColor('#00000000')
  const bridge = getGlassBridge()
  const hwnd = win.getNativeWindowHandle().readBigUInt64LE().toString()
  bridge.windows.add(hwnd)
  let syncing = false
  let dirty = false
  let refreshPending = true
  const sync = async (refresh = false) => {
    refreshPending ||= refresh === true
    if (win.isDestroyed() || win.isMinimized())
      return
    if (syncing) {
      dirty = true
      return
    }
    syncing = true
    try {
      do {
        dirty = false
        const refresh = refreshPending
        refreshPending = false
        const opacity = Math.max(0.2, Math.min(1, Number(preferences?.get('common.glassOpacity') ?? 78) / 100))
        const result = await bridge.request({ hwnd, radius: win.isMaximized() || win.isFullScreen() ? 0 : 32, opacity, refresh })
        if (!result && !win.isDestroyed())
          throw new Error('原生圆角区域未生效')
      } while (dirty && !win.isDestroyed())
    }
    catch (error) { console.error('[RoundedGlass]', error) }
    finally { syncing = false }
  }
  for (const event of ['resize', 'move', 'show', 'restore', 'maximize', 'unmaximize', 'enter-full-screen', 'leave-full-screen', 'fusion-refresh-shape', 'glass-refresh'])
    win.on(event, () => sync(['show', 'restore', 'glass-refresh'].includes(event)))
  const appearanceChanged = () => sync(true)
  const stopOpacity = preferences?.onDidChange('common.glassOpacity', appearanceChanged)
  nativeTheme.on('updated', appearanceChanged)
  win.once('closed', () => {
    stopOpacity?.()
    nativeTheme.removeListener('updated', appearanceChanged)
    bridge.windows.delete(hwnd)
    bridge.request({ command: 'forget', hwnd }).finally(() => {
      if (!bridge.windows.size)
        bridge.child.stdin.end()
    }).catch(() => {})
  })
  await sync(true)
}
