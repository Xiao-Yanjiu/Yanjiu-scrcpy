import store from '$electron/helpers/store/index.js'
import { globalEventEmitter } from '$electron/helpers/emitter/index.js'
import { appendFileSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import { createInterface } from 'node:readline'
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  nativeImage,
  screen,
} from 'electron'
import { extraResolve } from '$electron/process/resources.js'
import { getAdb, getScrcpy } from '$electron/configs/which/index.js'

const execFileAsync = promisify(execFile)
const owners = new Map()
const agentReady = new Map()
const connectionHealth = new Map()
const notificationApps = new Map()
const controlId = '__desktop_control__'
let notificationActionQueue = Promise.resolve()
const agentRemote = '/data/local/tmp/yanjiu-scrcpy-desktop-agent.jar'
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))

function sessionLog(data) {
  try {
    const file = path.join(app.getPath('logs'), 'desktop-sessions.log')
    try {
      if (statSync(file).size > 2 * 1024 * 1024)
        writeFileSync(file, '')
    }
    catch {}
    appendFileSync(
      file,
      `${JSON.stringify({ time: new Date().toISOString(), ...data })}\n`,
    )
  }
  catch {}
}
function desktopWindow(event) {
  const win = BrowserWindow.fromWebContents(event.sender)
  if (!win || !win.webContents.getURL().includes('pages/desktop/'))
    throw new Error('桌面窗口不可用')
  return win
}

function serial(value) {
  if (typeof value !== 'string' || !/^[\w.:-]{1,200}$/.test(value))
    throw new Error('设备标识无效')
  return value
}

async function adb(deviceId, args, options = {}) {
  const binary = getAdb()
  if (!binary)
    throw new Error('没有找到 ADB')
  const { stdout } = await execFileAsync(
    binary,
    ['-s', serial(deviceId), ...args],
    {
      windowsHide: true,
      timeout: 25000,
      maxBuffer: 24 * 1024 * 1024,
      ...options,
    },
  )
  return stdout
}

async function deviceConnection(deviceId) {
  deviceId = serial(deviceId)
  let state = connectionHealth.get(deviceId)
  if (!state) {
    state = { failures: 0, lastConnect: 0, checked: 0 }
    connectionHealth.set(deviceId, state)
  }
  if (state.pending)
    return state.pending
  if (Date.now() - state.checked < 500)
    return state.result
  state.pending = (async () => {
    let status = 'offline'
    let error = ''
    try {
      if (
        (await adb(deviceId, ['get-state'], { timeout: 3500 })).trim()
        === 'device'
      ) {
        status = 'device'
      }
    }
    catch (failure) {
      error = failure.stderr || failure.message || String(failure)
    }
    if (status !== 'device' && deviceId.includes(':')) {
      const backoff = Math.min(15000, 1000 * 2 ** Math.min(4, state.failures))
      if (Date.now() - state.lastConnect >= backoff) {
        state.lastConnect = Date.now()
        await execFileAsync(getAdb(), ['connect', deviceId], {
          windowsHide: true,
          timeout: 4000,
        }).catch(() => {})
      }
    }
    state.failures = status === 'device' ? 0 : state.failures + 1
    if (state.result?.status !== status) {
      sessionLog({ event: 'transport', deviceId, status, error })
      if (status !== 'device')
        agentReady.delete(deviceId)
    }
    state.checked = Date.now()
    state.result = { id: deviceId, status, failures: state.failures }
    return state.result
  })()
  try {
    return await state.pending
  }
  finally {
    state.pending = null
  }
}
const automationQueues = new Map()
function agent(deviceId, command) {
  if (!/^(?:quick-ui|notification-ui) /.test(command))
    return invokeAgent(deviceId, command)
  const previous = automationQueues.get(deviceId) || Promise.resolve()
  const operation = previous.catch(() => {}).then(() => invokeAgent(deviceId, command))
  automationQueues.set(deviceId, operation)
  operation.finally(() => {
    if (automationQueues.get(deviceId) === operation)
      automationQueues.delete(deviceId)
  }).catch(() => {})
  return operation
}
async function invokeAgent(deviceId, command) {
  if (!agentReady.has(deviceId)) {
    const ready = adb(deviceId, [
      'push',
      extraResolve('common/desktop-agent.jar'),
      agentRemote,
    ])
    agentReady.set(deviceId, ready)
    ready.catch(() => agentReady.delete(deviceId))
  }
  await agentReady.get(deviceId)
  const output = await adb(
    deviceId,
    [
      'shell',
      `CLASSPATH=${agentRemote} app_process /system/bin dev.yanjiu.scrcpy.desktop.Agent ${command}`,
    ],
    { timeout: 60000 },
  )
  const line = output
    .split(/\r?\n/)
    .find(text => text.startsWith('DESKTOP_AGENT:'))
  if (!line) {
    agentReady.delete(deviceId)
    throw new Error('手机未返回桌面数据，请重新连接后刷新')
  }
  const result = JSON.parse(line.slice('DESKTOP_AGENT:'.length))
  if (result.error)
    throw new Error(result.error)
  return result
}

class NativeBridge {
  constructor(win) {
    this.sequence = 0
    this.pending = new Map()
    const handle = win.getNativeWindowHandle().readBigUInt64LE().toString()
    this.child = spawn(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        extraResolve('win/desktop-window.ps1'),
        '-ParentHandle',
        handle,
      ],
      { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] },
    )
    this.ready = new Promise((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error('桌面窗口服务启动超时')),
        20000,
      )
      this.finishReady = (error) => {
        clearTimeout(timeout)
        error ? reject(error) : resolve()
      }
    })
    this.ready.catch(() => {})
    let errors = ''
    this.child.stderr.on('data', (data) => {
      errors = (errors + data).slice(-4000)
    })
    this.reader = createInterface({ input: this.child.stdout })
    this.reader.on('line', (line) => {
      let message
      try {
        message = JSON.parse(line)
      }
      catch {
        return
      }
      if (message.ready) {
        this.mouseAvailable = message.mouseAvailable !== false
        this.finishReady()
        return
      }
      if (message.event === 'pointer-down') {
        this.onPointerDown?.(message.appId)
        return
      }
      if (message.event === 'right-back') {
        this.onRightBack?.(message.appId)
        return
      }
      const pending = this.pending.get(message.id)
      if (!pending)
        return
      clearTimeout(pending.timer)
      this.pending.delete(message.id)
      message.error
        ? pending.reject(new Error(message.error))
        : pending.resolve(message.result)
    })
    const failed = (error) => {
      this.finishReady(error)
      for (const pending of this.pending.values()) {
        clearTimeout(pending.timer)
        pending.reject(error)
      }
      this.pending.clear()
    }
    this.child.on('error', failed)
    this.child.on('exit', () =>
      failed(new Error(errors || '桌面窗口服务已关闭')),
    )
    this.child.stdin.on('error', () => {})
  }

  async request(command, data = {}) {
    await this.ready
    if (this.child.exitCode !== null || this.child.killed)
      throw new Error('桌面窗口服务已关闭')
    const id = ++this.sequence
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error('桌面窗口操作超时'))
      }, 8000)
      this.pending.set(id, { resolve, reject, timer })
      this.child.stdin.write(`${JSON.stringify({ ...data, id, command })}\n`)
    })
  }

  close() {
    this.reader.close()
    this.child.stdin.end()
    this.child.kill()
  }
}

function stopWallpaper(owner) {
  const state = owner.wallpaper
  if (!state)
    return
  owner.wallpaper = null
  clearTimeout(state.timeout)
  state.reader?.close()
  state.child.stdin.end()
  state.child.kill()
  state.reject?.(new Error('壁纸同步已停止'))
}
function pumpWallpaper(owner) {
  const state = owner.wallpaper
  if (
    !state
    || !state.pending
    || state.awaiting
    || owner.win.isDestroyed()
    || !owner.win.isVisible()
    || owner.win.isMinimized()
    || owner.wallpaperHidden
  ) {
    return
  }
  const image = state.pending
  state.pending = null
  state.awaiting = ++state.sequence
  emit(owner, 'desktop-wallpaper-frame', { image, sequence: state.awaiting })
}
function pauseWallpaper(owner) {
  const state = owner.wallpaper
  if (!state?.ready)
    return
  const paused
    = owner.win.isDestroyed()
      || !owner.win.isVisible()
      || owner.win.isMinimized()
      || owner.wallpaperHidden
  if (paused) {
    state.reader.pause()
  }
  else {
    state.reader.resume()
    pumpWallpaper(owner)
  }
}
async function streamWallpaper(owner, deviceId, fit) {
  if (owner.wallpaper?.deviceId === deviceId && owner.wallpaper?.fit === fit)
    return owner.wallpaper.first
  stopWallpaper(owner)
  const bounds = owner.win.getContentBounds()
  const scale = Math.min(1, 1280 / bounds.width, 720 / bounds.height)
  const width = Math.max(160, Math.round(bounds.width * scale))
  const height = Math.max(160, Math.round(bounds.height * scale))
  const child = spawn(
    getAdb(),
    [
      '-s',
      deviceId,
      'shell',
      '-T',
      `CLASSPATH=${
        agentRemote
      } app_process /system/bin dev.yanjiu.scrcpy.desktop.Agent wallpaper-stream 12 ${
        width
      } ${height} ${fit}`,
    ],
    { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] },
  )
  const state = {
    deviceId,
    fit,
    child,
    sequence: 0,
    awaiting: 0,
    pending: null,
    ready: false,
  }
  state.first = new Promise((resolve, reject) => {
    state.resolve = resolve
    state.reject = reject
  })
  state.first.catch(() => {})
  state.timeout = setTimeout(() => {
    state.reject(
      new Error('手机暂未提供壁纸画面，请先解锁手机并回到手机桌面后重试'),
    )
    stopWallpaper(owner)
  }, 12000)
  owner.wallpaper = state
  state.reader = createInterface({ input: child.stdout })
  state.reader.on('line', (line) => {
    if (owner.wallpaper !== state)
      return
    if (line.startsWith('DESKTOP_WALLPAPER:')) {
      const image = line.slice('DESKTOP_WALLPAPER:'.length)
      if (
        !image.startsWith('data:image/jpeg;base64,')
        || image.length > 3 * 1024 * 1024
      ) {
        return
      }
      state.pending = image
      if (!state.ready) {
        state.ready = true
        clearTimeout(state.timeout)
        state.resolve({ live: true, image })
        state.reject = null
      }
      if (state.waiting) {
        state.waiting = false
        emit(owner, 'desktop-wallpaper-status', '')
      }
      pumpWallpaper(owner)
      pauseWallpaper(owner)
    }
    else if (line.startsWith('DESKTOP_WALLPAPER_WAIT:')) {
      state.waiting = true
      emit(
        owner,
        'desktop-wallpaper-status',
        '手机当前未提供新壁纸画面，请解锁并回到手机桌面；暂时保留最后画面',
      )
    }
    else if (line.startsWith('DESKTOP_AGENT:')) {
      try {
        const result = JSON.parse(line.slice('DESKTOP_AGENT:'.length))
        if (result.error) {
          state.reject?.(new Error(result.error))
          stopWallpaper(owner)
        }
      }
      catch {}
    }
  })
  child.stderr.on('data', () => {})
  child.stdin.on('error', () => {})
  child.on('error', (error) => {
    if (owner.wallpaper === state) {
      state.reject?.(error)
      stopWallpaper(owner)
    }
  })
  child.on('exit', () => {
    if (owner.wallpaper === state) {
      state.reject?.(new Error('壁纸读取通道已结束，请重新同步'))
      stopWallpaper(owner)
      emit(owner, 'desktop-wallpaper-status', '壁纸读取通道已结束，请重新同步')
    }
  })
  return state.first
}
function emit(owner, channel, data) {
  if (!owner.win.isDestroyed())
    owner.win.webContents.send(channel, data)
}

function stopTaskStream(owner) {
  const state = owner.tasks
  owner.tasks = null
  state?.reader.close()
  state?.child.stdin.end()
  state?.child.kill()
}
function taskSignature(task) {
  return task ? `${task.taskId}:${task.displayId}:${task.component}:${task.focused}` : ''
}
function routeTasks(owner, tasks) {
  const previous = owner.taskSnapshot || []
  owner.taskSnapshot = tasks
  if (!owner.tasksSeeded) {
    owner.tasksSeeded = true
    return
  }
  for (const [id, routed] of owner.routedTasks || []) {
    if (!tasks.some(task => task.taskId === id && task.displayId === routed.displayId))
      owner.routedTasks.delete(id)
  }
  for (const task of tasks) {
    if (!task.visible || !/^[\w.]+$/.test(task.packageName) || /^(?:com\.android\.(?:systemui|permissioncontroller|intentresolver)|android)$/.test(task.packageName))
      continue
    const before = previous.find(item => item.taskId === task.taskId)
    if (taskSignature(before) === taskSignature(task))
      continue
    if (owner.win.fusionRole === 'launcher')
      continue
    const source = [...owner.sessions.entries()].find(([id, session]) => id !== controlId && session.displayId === task.displayId)
    const fromControl = task.displayId === 0 && owner.control?.visible && Date.now() < (owner.control.interactingUntil || 0)
    if ((task.floating && (fromControl || source)) || (fromControl && task.focused === false))
      continue
    const call = task.displayId === 0 && /^(?:com\.tencent\.(?:mm|mobileqq)|com\.android\.(?:incallui|dialer|server\.telecom)|com\.(?:miui|google\.android)\.(?:incallui|dialer))$/.test(task.packageName) && /incall|voip|multitalk|calling|VideoActivity|AVActivity/i.test(task.component)
    if (!fromControl && !call && (!source || source[1].packageName === task.packageName))
      continue
    // System overlays stay in their source stream. Only an actual Activity task moves.
    if (/launcher|permissioncontroller|intentresolver/i.test(task.packageName))
      continue
    if (task.basePackage && task.basePackage !== task.packageName) {
      if (!owner.mixedTasks?.has(task.taskId)) {
        owner.mixedTasks ||= new Set()
        owner.mixedTasks.add(task.taskId)
        emit(owner, 'desktop-native-error', '此应用把外部页面放进了自身任务，暂时保留在原窗口，避免丢失页面内容')
      }
      continue
    }
    owner.routedTasks ||= new Map()
    const signature = taskSignature(task)
    if (owner.routedTasks.get(task.taskId)?.signature === signature)
      continue
    owner.routedTasks.set(task.taskId, { signature, displayId: task.displayId })
    emit(owner, 'desktop-external-app', { ...task, fromControl })
  }
}
async function ensureTaskStream(owner, deviceId) {
  if (owner.tasks?.deviceId === deviceId || owner.closed)
    return
  if (owner.taskStarting)
    return owner.taskStarting
  const pending = (async () => {
    const snapshot = await agent(deviceId, 'tasks')
    if (owner.closed)
      return
    stopTaskStream(owner)
    owner.taskSnapshot = snapshot.tasks || []
    owner.tasksSeeded = true
    const child = spawn(getAdb(), ['-s', deviceId, 'shell', '-T', `CLASSPATH=${agentRemote} app_process /system/bin dev.yanjiu.scrcpy.desktop.Agent task-stream`], { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] })
    const reader = createInterface({ input: child.stdout })
    const state = { child, reader, deviceId }
    owner.tasks = state
    child.stdin.on('error', () => {})
    reader.on('line', (line) => {
      if (owner.tasks !== state || !line.startsWith('DESKTOP_TASKS:'))
        return
      try {
        routeTasks(owner, JSON.parse(line.slice('DESKTOP_TASKS:'.length)).tasks || [])
      }
      catch {}
    })
    const ended = () => {
      if (owner.tasks === state)
        stopTaskStream(owner)
    }
    child.once('exit', ended)
    child.once('error', ended)
  })()
  owner.taskStarting = pending
  try {
    await pending
  }
  finally {
    if (owner.taskStarting === pending)
      owner.taskStarting = null
  }
}
const quickIconCache = new Map()
function parseQuickTiles(output, specs) {
  const ordered = specs.trim().split(',').filter(spec => spec && spec !== 'null')
  const rows = output.split(/\r?\n/).filter(line => /QSTile\$\w*State\[/.test(line))
  return rows.map((line, index) => {
    const text = line.slice(line.indexOf('[') + 1, line.lastIndexOf(']'))
    const field = key => text.match(new RegExp(`(?:^|,)${key}=(.*?)(?=,[a-zA-Z]+=[^=]|$)`))?.[1] || ''
    const value = key => field(key) === 'null' ? '' : field(key)
    const spec = value('spec') || ordered[index]
    const state = Number(value('state'))
    return {
      spec,
      label: value('label') || spec,
      description: value('contentDescription'),
      secondary: value('secondaryLabel'),
      state,
      active: state === 2,
      enabled: state !== 0 && value('disabledByPolicy') !== 'true',
      resourceId: Number.parseInt(line.match(/ResourceIcon\[resId=(0x[\da-f]+)/i)?.[1] || '0', 16),
    }
  }).filter(tile => tile.spec && tile.spec !== 'edit').slice(0, 80)
}
async function readQuickSettings(owner, deviceId) {
  const [dump, specs, state, flags] = await Promise.all([
    adb(deviceId, ['shell', 'dumpsys activity service com.android.systemui/.SystemUIService QSTileHost'], { timeout: 5000 }),
    adb(deviceId, ['shell', 'settings get secure sysui_qs_tiles'], { timeout: 4000 }),
    agent(deviceId, 'quick-state'),
    adb(deviceId, ['shell', 'settings get global bluetooth_on; settings get system accelerometer_rotation; settings get global airplane_mode_on; settings get global mobile_data'], { timeout: 4000 }),
  ])
  const values = flags.trim().split(/\r?\n/).map(value => value.trim())
  state.active ||= {}
  for (const [index, spec] of ['bt', 'rotation', 'airplane', 'cell'].entries()) {
    if (/^[01]$/.test(values[index] || ''))
      state.active[spec] = spec === 'rotation' ? values[index] === '0' : values[index] === '1'
  }
  const tiles = parseQuickTiles(dump, specs)
  if (!tiles.length)
    throw new Error('这台手机未向 ADB 提供快捷设置列表')
  const iconKey = tile => `${deviceId}:${tile.spec}:${tile.resourceId}`
  const missing = tiles.filter(tile => !quickIconCache.has(iconKey(tile)))
  if (missing.length) {
    const icons = await agent(deviceId, `quick-icons ${Buffer.from(JSON.stringify(missing.map(tile => ({ spec: tile.spec, resourceId: tile.resourceId })))).toString('base64')}`).catch(() => ({ icons: {} }))
    for (const tile of missing)
      quickIconCache.set(iconKey(tile), icons.icons?.[tile.spec] || '')
  }
  for (const tile of tiles) {
    tile.icon = quickIconCache.get(iconKey(tile))
    if (typeof state.active?.[tile.spec] === 'boolean')
      tile.active = state.active[tile.spec]
    if (tile.spec === 'wifi' && state.wifiName)
      tile.label = state.wifiName
  }
  owner.control.catalog = new Map(tiles.map(tile => [tile.spec, tile]))
  return { tiles, ...state, dialog: owner.control.dialog || null }
}
function quickOperation(owner, operation) {
  const pending = (owner.quickQueue || Promise.resolve()).catch(() => {}).then(operation)
  owner.quickQueue = pending.catch(() => {})
  return pending
}
function storeQuickDialog(owner, result) {
  if (owner.control) {
    const dialog = result.dialog
    const previous = owner.control.dialog
    if (dialog && previous && previous.packageName === dialog.packageName && previous.rootResource === dialog.rootResource) {
      owner.control.dialog = { ...dialog, token: previous.token }
      return owner.control.dialog
    }
    owner.quickSequence = (owner.quickSequence || 0) + 1
    owner.control.dialog = dialog ? { ...dialog, token: `${Date.now()}-${owner.quickSequence}` } : null
  }
  return owner.control?.dialog || null
}

async function focusDesktopInput(event, active = true) {
  const win = desktopWindow(event)
  const owner = owners.get(event.sender.id)
  if (owner) {
    owner.hostInput = Boolean(active)
    await owner.bridge.request('host-input', { active: Boolean(active) })
  }
  if (active) {
    win.focusOnWebView()
    win.webContents.focus()
  }
  return true
}
function ownerFor(event) {
  const win = desktopWindow(event)
  const key = event.sender.id
  let owner = owners.get(key)
  if (owner)
    return owner
  owner = {
    win,
    sessions: new Map(),
    opening: new Map(),
    bridge: new NativeBridge(win),
    layout: null,
    syncing: false,
    closed: false,
    hostInput: false,
  }
  owners.set(key, owner)
  win.on('blur', () => emit(owner, 'desktop-native-pointer', ''))
  owner.bridge.onPointerDown = (id) => {
    owner.hostInput = false
    emit(owner, 'desktop-native-pointer', id)
  }
  owner.bridge.onRightBack = (id) => {
    const session = owner.sessions.get(id)
    if (!session?.rightBack || !Number.isInteger(session.displayId) || session.displayId < 0)
      return
    emit(owner, 'desktop-app-activated', id)
    session.backQueue = (session.backQueue || Promise.resolve())
      .then(async () => {
        if (owner.sessions.get(id) !== session || !session.rightBack)
          return
        await adb(session.deviceId, [
          'shell',
          'input',
          '-d',
          String(session.displayId),
          'keyevent',
          '4',
        ])
      })
      .catch(error =>
        emit(owner, 'desktop-native-error', `右键返回失败：${error.message}`),
      )
  }
  owner.focusTimer = setInterval(async () => {
    if (owner.closed || !owner.sessions.size)
      return
    const id = await owner.bridge.request('active').catch(() => '')
    if (!owner.hostInput && id && id !== owner.focused) {
      owner.focused = id
      emit(owner, 'desktop-app-activated', id)
    }
  }, 450)
  for (const name of ['hide', 'minimize', 'show', 'restore'])
    win.on(name, () => pauseWallpaper(owner))
  win.once('closed', () => {
    stopScreenSession(owner)

    stopTaskStream(owner)
    stopWallpaper(owner)
    owner.closed = true
    owner.phoneMirror?.kill()
    clearInterval(owner.focusTimer)
    for (const id of owner.sessions.keys()) closeSession(owner, id)
    owner.audio?.kill()
    owner.bridge.close()
    owners.delete(key)
  })
  return owner
}

function stopScreenSession(owner) {
  const state = owner.screenOff
  owner.screenOff = null
  state?.child.kill()
}
function ensureScreenSession(owner, deviceId) {
  // One physical display has one power owner. Closing an app must not run
  // another scrcpy controller's display-power restoration.
  if (owner.win.fusionRole === 'app') {
    const launcher = [...owners.values()].find(entry => entry.win.fusionRole === 'launcher' && entry.win.fusionDeviceId === deviceId && !entry.closed)
    if (launcher)
      return ensureScreenSession(launcher, deviceId)
    return false
  }
  if (!(owner.win.fusionRole ? store.get('fusionMode.fusionScreenOff') : store.get('desktopMode.desktopScreenOff'))) {
    stopScreenSession(owner)
    return false
  }
  if (owner.screenOff?.deviceId === deviceId)
    return true
  if (Date.now() < (owner.screenRetryAt || 0))
    return false
  stopScreenSession(owner)
  const child = spawn(
    getScrcpy(),
    [
      `--serial=${deviceId}`,
      '--no-window',
      '--no-video',
      '--no-audio',
      '--no-power-on',
      '--turn-screen-off',
      '--no-clipboard-autosync',
    ],
    {
      env: { ...process.env, ADB: getAdb() },
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )
  const state = { child, deviceId, log: '' }
  owner.screenOff = state
  const read = (data) => {
    state.log = (state.log + data).slice(-1200)
  }
  child.stdout.on('data', read)
  child.stderr.on('data', read)
  const ended = (error) => {
    if (owner.screenOff !== state || owner.closed)
      return
    owner.screenOff = null
    owner.screenRetryAt = Date.now() + 15000
    if (error) {
      emit(
        owner,
        'desktop-native-error',
        `手机黑屏控制未启动：${(error.message || state.log).slice(-180)}`,
      )
    }
  }
  child.once('error', ended)
  child.once('exit', code =>
    ended(code ? new Error(state.log || '屏幕控制连接已结束') : null),
  )
  return true
}
function closeSession(owner, id) {
  const session = owner.sessions.get(id)
  if (!session)
    return
  session.deliberate = true
  owner.sessions.delete(id)
  if (!session.child.killed)
    session.child.kill()
  owner.bridge.request('forget', { appId: id }).catch(() => {})
  if (!owner.sessions.size) {
    owner.audio?.kill()
    owner.audio = null
  }
}

async function checkedShell(deviceId, command) {
  const output = await adb(deviceId, ['shell', command])
  if (
    /Exception|Permission denial|Error:|Unknown command|not found|failed/i.test(
      output,
    )
  ) {
    throw new Error(output.trim().slice(0, 300))
  }
  return output
}
async function readPhoneState(deviceId) {
  const output = await adb(deviceId, [
    'shell',
    'echo DESK_VOLUME; cmd media_session volume --stream 3 --get; echo DESK_BRIGHTNESS; cmd display get-brightness 0; echo DESK_WIFI; settings get global wifi_on; echo DESK_BLUETOOTH; settings get global bluetooth_on; echo DESK_AIRPLANE; settings get global airplane_mode_on; echo DESK_POWER; settings get global low_power; echo DESK_DARK; cmd uimode night; echo DESK_ROTATION; settings get system accelerometer_rotation; echo DESK_LOCATION; cmd location is-location-enabled; echo DESK_CELL; settings get global mobile_data',
  ])
  const section = key =>
    output
      .replace(/\r/g, '')
      .split(`DESK_${key}\n`)[1]
      ?.split('DESK_')[0]
      ?.trim() || ''
  const volume = section('VOLUME').match(
    /volume is (\d+) in range \[\s*\d+\s*\.\.\s*(\d+)\s*\]/,
  )
  const brightness = Number.parseFloat(section('BRIGHTNESS'))
  if (!volume || !Number.isFinite(brightness))
    throw new Error(`手机控制状态读取失败：${output.slice(0, 180)}`)
  return {
    volume: Math.round((Number(volume[1]) * 100) / Number(volume[2])),
    brightness: Math.round(brightness * 100),
    wifi: Number(section('WIFI')) > 0,
    bluetooth: Number(section('BLUETOOTH')) > 0,
    airplane: section('AIRPLANE') === '1',
    powerSave: section('POWER') === '1',
    dark: /yes|custom/i.test(section('DARK')),
    rotation: section('ROTATION') === '0',
    location: section('LOCATION') === 'true',
    cellular: section('CELL') === '1',
  }
}
function parseNotificationDismissibility(output) {
  const count = output.match(/non-dismissible entries:\s*(\d+)/)
  if (!count)
    return null
  const keys = new Set([...output.matchAll(/(?:^|\s)(-?\d+\|[\w.]+\|[^\s\],)]+)/gm)].map(match => match[1]))
  return keys.size === Number(count[1]) ? keys : null
}
function parseShadeNotifications(output) {
  if (!/ShadeListBuilder shade notifications:/.test(output))
    return null
  return [...output.matchAll(/^\s*\[([^\]]+)\]\s+(\S+)\s+\(parent=([^)]*)\).*$/gm)].map(match => ({ key: match[2], groupId: match[3] === '<root>' ? match[2] : match[3], summary: match[1].includes(':*') }))
}
function parsePhoneNotifications(output) {
  const list = output.match(/^[ \t]*Notification List:[ \t]*\r?\n/m)
  if (!list)
    throw new Error('手机未返回当前通知列表')
  const active = output
    .slice(list.index + list[0].length)
    .split(/^[ \t]{0,2}\S/m)[0]
  const records = active
    .split(/^[ \t]+(?=NotificationRecord\()/m)
    .filter(block => block.startsWith('NotificationRecord('))
  return records
    .map((block, index) => {
      const field = (name) => {
        const line
          = block
            .match(new RegExp(`^[ \t]+android\.${name}=(.*)$`, 'm'))?.[1]
            ?.trim() || ''
        if (line === 'null')
          return ''
        return line.replace(
          /^(?:String|SpannableString|SpannedString|SpannableStringBuilder)\s*\(([\s\S]*)\)$/,
          '$1',
        )
      }
      const packageName = block.match(/\bpkg=([\w.]+)/)?.[1] || ''
      const time
        = Number(block.match(/\bm(?:Update|Creation)TimeMs=(\d+)/)?.[1]) || 0
      const title = field('title') || field('title.big')
      const text = field('bigText') || field('text')
      const flags = Number.parseInt(
        block.match(/\bflags=(0x[0-9a-f]+|\d+)/i)?.[1] || '0',
        0,
      )
      const namedFlags = block.match(/^\s*flags=([^\r\n]+)/m)?.[1] || ''
      const ongoing = !!(flags & 34) || /ONGOING_EVENT|NO_CLEAR/.test(namedFlags)
      const summary = !!(flags & 512) || /GROUP_SUMMARY|AUTOGROUP_SUMMARY/.test(namedFlags)
      return {
        key: block.match(/\bkey=([^\s,)]+)/)?.[1] || `${packageName}:${index}`,
        packageName,
        title,
        text,
        time,
        ongoing,
        summary,
        hidden: /mHidden=+true/.test(block),
        importance: Number(block.match(/\bimportance=(\d+)/)?.[1] || 3),
      }
    })
    .filter(notice => notice.packageName && (notice.title || notice.text))
    .slice(0, 80)
}
async function readPhoneNotifications(deviceId) {
  const output = await adb(deviceId, [
    'shell',
    'dumpsys notification --noredact',
  ])
  let notices = parsePhoneNotifications(output).filter(item => !item.summary && !item.hidden && item.importance > 0)
  const [shadeDump, dismissibilityDump] = await Promise.all([
    adb(deviceId, ['shell', 'dumpsys activity service com.android.systemui/.SystemUIService ShadeListBuilder'], { timeout: 5000 }).catch(() => ''),
    adb(deviceId, ['shell', 'dumpsys activity service com.android.systemui/.SystemUIService NotificationDismissibilityProvider'], { timeout: 5000 }).catch(() => ''),
  ])
  const nonDismissible = parseNotificationDismissibility(dismissibilityDump)
  const shade = parseShadeNotifications(shadeDump)
  if (shade) {
    const records = new Map(notices.map(item => [item.key, item]))
    notices = shade.filter(item => !item.summary && records.has(item.key)).map(item => ({ ...records.get(item.key), groupId: item.groupId }))
  }
  const packages = [...new Set(notices.map(item => item.packageName))]
  const missing = packages.filter(
    pkg => !notificationApps.has(`${deviceId}:${pkg}`),
  )
  if (missing.length) {
    const fetched = (
      await agent(deviceId, `notification-apps ${missing.join(' ')}`)
    ).apps
    for (const pkg of missing)
      notificationApps.set(`${deviceId}:${pkg}`, fetched[pkg] || {})
  }
  const info = Object.fromEntries(
    packages.map(pkg => [pkg, notificationApps.get(`${deviceId}:${pkg}`)]),
  )
  return notices.map(item => ({
    ...item,
    dismissible: nonDismissible ? !nonDismissible.has(item.key) : !item.ongoing,
    appName: info[item.packageName]?.name || item.packageName,
    icon: info[item.packageName]?.icon || '',
  }))
}
async function deviceLayout(deviceId) {
  const output = await adb(serial(deviceId), ['shell', 'wm size; wm density'])
  const sizes = [
    ...output.matchAll(/(?:Physical|Override) size:\s*(\d+)x(\d+)/g),
  ]
  const densities = [
    ...output.matchAll(/(?:Physical|Override) density:\s*(\d+)/g),
  ]
  if (!sizes.length || !densities.length)
    throw new Error('无法读取设备默认分辨率与 DPI')
  const size = sizes.at(-1)
  return {
    width: Number(size[1]),
    height: Number(size[2]),
    dpi: Number(densities.at(-1)[1]),
  }
}
function displaySpec(config = {}) {
  const width = Math.round(Number(config.width))
  const height = Math.round(Number(config.height))
  const dpi = Math.round(Number(config.dpi))
  if (
    !Number.isFinite(width)
    || !Number.isFinite(height)
    || !Number.isFinite(dpi)
    || width < 320
    || height < 320
    || width > 3840
    || height > 3840
    || dpi < 100
    || dpi > 640
  ) {
    throw new Error('分辨率范围为 320–3840，DPI 范围为 100–640')
  }
  return { width: width - (width % 8), height: height - (height % 8), dpi }
}

function ensureAudio(owner, deviceId) {
  owner.audioDeviceId = deviceId
  const key = owner.win.fusionRole ? 'fusionMode.fusionDisableAudioForwarding' : 'desktopMode.desktopDisableAudioForwarding'
  if (store.get(key)) {
    owner.audio?.kill()
    owner.audio = null
    return
  }
  if (owner.win.fusionRole === 'app') {
    const coordinator = [...owners.values()].find(entry => entry.win.fusionRole === 'launcher' && entry.win.fusionDeviceId === deviceId && !entry.closed)
    if (coordinator)
      return ensureAudio(coordinator, deviceId)
  }
  if (owner.audio)
    return
  const child = spawn(
    getScrcpy(),
    [
      `--serial=${deviceId}`,
      '--no-video',
      '--no-control',
      '--no-window',
      '--no-power-on',
    ],
    {
      env: { ...process.env, ADB: getAdb() },
      windowsHide: true,
      stdio: 'ignore',
    },
  )
  owner.audio = child
  child.on('error', () => {
    if (owner.audio === child)
      owner.audio = null
  })
  child.on('exit', () => {
    if (owner.audio === child)
      owner.audio = null
  })
}

async function startSession(owner, request) {
  const deviceId = serial(request.deviceId)
  const { id, packageName } = request
  if (
    typeof id !== 'string'
    || !/^[\w.-]{1,180}$/.test(id)
    || !/^[\w.]{1,180}$/.test(packageName || '')
  ) {
    throw new Error('应用标识无效')
  }
  if (owner.sessions.has(id)) {
    const session = owner.sessions.get(id)
    return { id, ...session.config, displayId: session.displayId, rightBack: session.rightBack, frameSize: session.frameSize }
  }
  if (owner.sessions.size >= 12)
    throw new Error('请先关闭部分应用，桌面最多同时打开 12 个应用')
  const background
    = id === '__desktop_wallpaper__' && packageName === 'dev.yanjiu.scrcpy.wallpaper'
  const control = false
  if (id === controlId)
    throw new Error('控制中心使用直接控件，不创建手机投屏')
  const config
    = control || request.config?.layout === 'device'
      ? await deviceLayout(deviceId)
      : displaySpec(request.config)
  const desktopPrefs = store.get('desktopMode') || {}
  const screenOff = owner.win.fusionRole ? store.get('fusionMode.fusionScreenOff') : desktopPrefs.desktopScreenOff
  const inputModes = new Set(['sdk', 'uhid', 'disabled'])
  const binary = getScrcpy()
  if (!binary)
    throw new Error('没有找到 scrcpy')
  const child = spawn(
    binary,
    [
      `--serial=${deviceId}`,
      `--window-title=Yanjiu-scrcpy Desktop ${id}`,
      '--window-borderless',
      '--window-x=-32000',
      '--window-y=-32000',
      '--no-audio',
      '--mouse-bind=++++:++++',
      ...(control ? [] : ['--display-ime-policy=local']),
      ...(background || control ? [] : ['--no-vd-system-decorations']),
      '--max-fps=60',
      `--mouse=${!control && inputModes.has(request.config?.mouse || desktopPrefs.desktopMouse) ? (request.config?.mouse || desktopPrefs.desktopMouse) : 'sdk'}`,
      `--keyboard=${!control && inputModes.has(request.config?.keyboard || desktopPrefs.desktopKeyboard) ? (request.config?.keyboard || desktopPrefs.desktopKeyboard) : 'sdk'}`,
      ...(screenOff ? ['--no-power-on'] : []),
      ...(control ? ['--display-id=0', '--max-size=1440'] : [`--new-display=${config.width}x${config.height}/${config.dpi}`, ...(request.taskId ? [] : [`--start-app=${packageName}`])]),
    ],
    {
      env: { ...process.env, ADB: getAdb() },
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )
  const session = {
    child,
    config,
    deviceId,
    packageName,
    displayId: control ? 0 : null,
    control,
    log: '',
    deliberate: false,
    rightBack: Boolean(request.rightBack),
  }
  owner.sessions.set(id, session)
  const collect = (buffer) => {
    session.log = (session.log + buffer.toString()).slice(-12000)
  }
  for (const stream of [child.stdout, child.stderr]) {
    stream.on('data', collect)
    const lines = createInterface({ input: stream })
    lines.on('line', (line) => {
      if (owner.sessions.get(id) !== session)
        return
      const match = line.match(/New display:.+?\(id=(\d+)\)/)
      if (match)
        session.displayId = Number(match[1])
      const frame = line.match(/Texture: (\d+)x(\d+)\s*$/)
      if (frame && (session.frameSize?.width !== Number(frame[1]) || session.frameSize?.height !== Number(frame[2]))) {
        session.frameSize = { width: Number(frame[1]), height: Number(frame[2]) }
        emit(owner, 'desktop-app-frame-size', { id, ...session.frameSize })
      }
    })
  }
  child.on('error', (error) => {
    session.error = error.message
  })
  child.on('exit', (code, signal) => {
    sessionLog({
      event: 'app-exit',
      packageName,
      displayId: session.displayId,
      code,
      signal,
      deliberate: session.deliberate,
      log: session.log,
    })
    if (owner.sessions.get(id) !== session)
      return
    owner.sessions.delete(id)
    owner.bridge.request('forget', { appId: id }).catch(() => {})
    if (!session.deliberate) {
      emit(owner, 'desktop-app-exited', {
        id,
        code,
        error: session.error || session.log.slice(-1200),
      })
    }
    if (!owner.sessions.size) {
      owner.audio?.kill()
      owner.audio = null
    }
  })
  try {
    let attached = false
    for (let attempt = 0; attempt < 160; attempt++) {
      if (owner.closed || !owner.sessions.has(id) || session.error)
        throw new Error(session.error || session.log || '应用已关闭')
      attached = await owner.bridge.request('attach', {
        appId: id,
        pid: child.pid,
        title: `Yanjiu-scrcpy Desktop ${id}`,
      })
      if (attached)
        break
      await delay(100)
    }
    if (!attached)
      throw new Error(session.log || '应用窗口启动超时')
    if (
      session.rightBack
      && (!owner.bridge.mouseAvailable || !Number.isInteger(session.displayId))
    ) {
      session.rightBack = false
      emit(
        owner,
        'desktop-native-error',
        '此应用的右键返回暂不可用，已保留正常右键',
      )
    }
    await owner.bridge.request('right-button', {
      appId: id,
      enabled: session.rightBack,
    })
    if (background)
      await owner.bridge.request('background', { appId: id })
    else if (!control)
      ensureAudio(owner, deviceId)
    if (request.taskId && !control) {
      if (!Number.isInteger(request.taskId) || request.taskId <= 0 || !session.displayId)
        throw new Error('应用任务或显示器无效')
      const task = owner.taskSnapshot?.find(item => item.taskId === request.taskId && item.packageName === packageName)
      if (!task)
        throw new Error('应用页面已经变化，请重试')
      await agent(deviceId, `notification-attach ${Buffer.from(JSON.stringify({ taskId: request.taskId, displayId: session.displayId })).toString('base64')}`)
    }
    return {
      id,
      ...config,
      displayId: session.displayId,
      rightBack: session.rightBack,
      frameSize: session.frameSize,
    }
  }
  catch (error) {
    closeSession(owner, id)
    throw error
  }
}

function hostIsFullscreen(win) {
  return win.isFullScreen()
}
async function changeHostFullscreen(win, enabled) {
  if (win.isFullScreen() === enabled)
    return enabled
  win.fusionShapeSuspended = true
  if (win.fusionRole === 'launcher')
    win.setShape([])
  win.setAspectRatio(0)
  try {
    await new Promise((resolve, reject) => {
      const name = enabled ? 'enter-full-screen' : 'leave-full-screen'
      let timer
      const finished = () => {
        clearTimeout(timer)
        win.removeListener(name, finished)
        setTimeout(resolve, 100)
      }
      win.once(name, finished)
      timer = setTimeout(() => {
        win.removeListener(name, finished)
        win.isFullScreen() === enabled ? resolve() : reject(new Error('窗口全屏切换未完成，请重试'))
      }, 2000)
      win.setFullScreen(enabled)
    })
  }
  finally {
    win.fusionShapeSuspended = false
    win.emit('fusion-refresh-shape')
    if (!hostIsFullscreen(win) && store.get('desktopMode.desktopResizeMode') !== 'adaptive')
      win.setAspectRatio(win.fusionRatio || 0, win.fusionRatioExtra || { width: 0, height: 0 })
  }
  return win.isFullScreen()
}
function nativeRect(rect, scale) {
  const coordinate = value =>
    Math.round(Math.max(-50000, Math.min(50000, Number(value) || 0)) * scale)
  return {
    x: coordinate(rect.x),
    y: coordinate(rect.y),
    width: Math.max(0, coordinate((Number(rect.x) || 0) + (Number(rect.width) || 0)) - coordinate(rect.x)),
    height: Math.max(0, coordinate((Number(rect.y) || 0) + (Number(rect.height) || 0)) - coordinate(rect.y)),
    radius: Math.round(Math.max(0, Math.min(100, Number(rect.radius) || 0)) * scale),
  }
}

async function syncLayout(owner) {
  if (owner.syncing || owner.closed)
    return
  owner.syncing = true
  try {
    while (owner.layout && !owner.closed) {
      const layout = owner.layout
      owner.layout = null
      const scale
        = screen.getDisplayMatching(owner.win.getBounds()).scaleFactor
          * owner.win.webContents.getZoomFactor()
      const windows = layout
        .filter(item => owner.sessions.has(item.id))
        .slice(0, 13)
        .map(item => ({
          id: item.id,
          ...nativeRect(item, scale),
          visible: Boolean(item.visible),
          radius: Math.max(0, Math.min(32, Number(item.radius) || 0)) * scale,
          clips: (item.clips || [])
            .slice(0, 40)
            .map(rect => nativeRect(rect, scale)),
        }))
      await owner.bridge.request('sync', { windows })
    }
  }
  catch (error) {
    emit(owner, 'desktop-native-error', error.message)
  }
  finally {
    owner.syncing = false
  }
}

export default {
  name: 'module:desktop:embed',
  apply() {
    globalEventEmitter.on('boss:visibility', (hidden) => {
      for (const owner of owners.values()) {
        if (owner.phoneMirror && !owner.phoneMirror.killed && owner.phoneMirror.exitCode === null) {
          owner.bridge.request('mirror-visibility', { pid: owner.phoneMirror.pid, title: '手机镜像', hidden })
            .catch(error => sessionLog({ action: 'mirror-boss-visibility', error: error.message }))
        }
      }
    })
    for (const key of ['desktopMode.desktopDisableAudioForwarding', 'fusionMode.fusionDisableAudioForwarding']) {
      store.onDidChange(key, () => {
        for (const owner of owners.values()) {
          if (owner.closed || Boolean(owner.win.fusionRole) !== key.startsWith('fusionMode.'))
            continue
          if (owner.audioDeviceId && (owner.audio || owner.sessions.size || owner.phoneMirror || [...owners.values()].some(entry => entry.win.fusionDeviceId === owner.audioDeviceId && entry.sessions.size)))
            ensureAudio(owner, owner.audioDeviceId)
        }
      })
    }
    const applyMaterial = (win) => {
      if (process.platform !== 'win32' || win.isDestroyed() || win.roundedGlass)
        return
      try {
        win.setBackgroundColor('#00000000')
        win.setBackgroundMaterial('acrylic')
      }
      catch {}
    }
    for (const win of BrowserWindow.getAllWindows()) applyMaterial(win)
    app.on('browser-window-created', (_event, win) => applyMaterial(win))
    ipcMain.handle('desktop-phone-mirror', async (event, deviceId) => {
      if (app.bossHidden)
        return false
      const owner = ownerFor(event)
      deviceId = serial(deviceId)
      if (owner.phoneMirror && !owner.phoneMirror.killed && owner.phoneMirror.exitCode === null) {
        await owner.bridge.request('mirror-focus', { pid: owner.phoneMirror.pid, title: '手机镜像' })
        return true
      }
      const settings = store.get('desktopMode') || {}
      const screenOff = owner.win.fusionRole ? store.get('fusionMode.fusionScreenOff') : settings.desktopScreenOff
      if (screenOff)
        ensureScreenSession(owner, deviceId)
      // The mode's dedicated screen controller restores power on final exit.
      // A temporary mirror must not run its own power restoration when closed.
      const child = spawn(getScrcpy(), [`--serial=${deviceId}`, '--display-id=0', '--force-adb-forward', '--window-title=手机镜像', '--no-audio', '--max-fps=60', '--keyboard=sdk', '--mouse=sdk', ...(screenOff ? ['--no-power-on', '--no-cleanup', '--turn-screen-off'] : [])], { windowsHide: true, env: { ...process.env, ADB: getAdb() }, stdio: ['ignore', 'pipe', 'pipe'] })
      owner.phoneMirror = child
      await new Promise((resolve, reject) => {
        let timer
        let settled = false
        let log = ''
        const finish = (error) => {
          if (settled)
            return
          settled = true
          clearTimeout(timer)
          error ? reject(error) : resolve()
        }
        timer = setTimeout(() => {
          child.kill()
          finish(new Error('手机镜像启动超时'))
        }, 18000)
        const collect = (data) => {
          log = (log + data).slice(-2500)
          if (/Renderer:|Texture:/.test(log))
            finish()
        }
        child.stdout.on('data', collect)
        child.stderr.on('data', collect)
        child.once('error', finish)
        child.once('exit', () => {
          if (owner.phoneMirror === child)
            owner.phoneMirror = null
          finish(new Error(log || '手机镜像已关闭'))
        })
      })
      if (app.bossHidden)
        await owner.bridge.request('mirror-visibility', { pid: child.pid, title: '手机镜像', hidden: true })
      ensureAudio(owner, deviceId)
      return true
    })
    ipcMain.handle('desktop-fusion-launcher', async (event, expanded) => {
      const owner = ownerFor(event)
      const win = owner.win
      if (win.fusionRole !== 'launcher')
        throw new Error('不是融合模式应用栏')
      if (app.bossHidden) {
        win.setSkipTaskbar(true)
        win.hide()
        return false
      }
      const generation = owner.launcherGeneration = (owner.launcherGeneration || 0) + 1
      if (!expanded) {
        if (!win.isMinimized())
          win.minimize()
        await delay(100)
        if (!win.isDestroyed())
          await owner.bridge.request('popup-taskbar')
        return true
      }
      if (!owner.taskbarReady) {
        await owner.bridge.request('popup-taskbar')
        owner.taskbarReady = true
      }
      let anchor
      {
        const raw = await owner.bridge.request('fusion-anchor').catch(() => null)
        const iconPoint = raw ? screen.screenToDipPoint({ x: Math.round(raw.x + raw.width / 2), y: Math.round(raw.y) }) : null
        const display = iconPoint ? screen.getDisplayNearestPoint(iconPoint) : screen.getPrimaryDisplay()
        const area = display.workArea
        const point = iconPoint || { x: area.x + Math.round(area.width / 2), y: area.y + area.height }
        anchor = { area, centerX: point.x, bottom: Math.min(point.y, area.y + area.height) - 6 }
      }
      if (win.isDestroyed() || generation !== owner.launcherGeneration)
        return false
      const width = Math.min(620, anchor.area.width)
      const height = Math.min(680, anchor.area.height)
      win.setBounds({ x: Math.max(anchor.area.x, Math.min(Math.round(anchor.centerX - width / 2), anchor.area.x + anchor.area.width - width)), y: Math.max(anchor.area.y, anchor.bottom - height), width, height })
      if (win.isMinimized())
        win.restore()
      win.show()
      win.focus()
      const result = await owner.bridge.request('popup-taskbar')
      win.emit('glass-refresh')
      return result
    })
    ipcMain.handle('desktop-fusion-app-layout', (event, ratio) => {
      const win = desktopWindow(event)
      if (win.fusionRole !== 'app' || !Number.isFinite(ratio) || ratio < 0.1 || ratio > 10)
        return false
      const area = screen.getDisplayMatching(win.getBounds()).workArea
      const [outerWidth, outerHeight] = win.getSize()
      const [contentWidth, contentHeight] = win.getContentSize()
      const extra = { width: outerWidth - contentWidth, height: outerHeight - contentHeight + 32 }
      if (!win.fusionLayoutReady && !store.get('fusionAppBounds')?.[win.fusionBoundsKey]) {
        const height = Math.min(820, area.height - 32)
        const width = Math.min(area.width - 32, Math.round((height - extra.height) * ratio) + extra.width)
        win.setSize(Math.max(240, width), Math.max(320, Math.round((width - extra.width) / ratio) + extra.height))
      }
      if (win.fusionRatio && Math.abs(win.fusionRatio - ratio) > 0.001 && !hostIsFullscreen(win)) {
        const bounds = win.getBounds()
        let width = (win.fusionRatio > 1) !== (ratio > 1) ? bounds.height - extra.height : bounds.width - extra.width
        let height = width / ratio
        const scale = Math.min(1, (area.width - 24) / width, (area.height - 24) / height)
        width *= scale
        height *= scale
        win.setSize(Math.max(240, Math.round(width) + extra.width), Math.max(320, Math.round(height) + extra.height))
      }
      win.fusionRatioExtra = extra
      win.fusionRatio = ratio
      win.fusionLayoutReady = true
      if (!hostIsFullscreen(win) && !win.fusionShapeSuspended && store.get('desktopMode.desktopResizeMode') !== 'adaptive')
        win.setAspectRatio(ratio, extra)
      return true
    })
    ipcMain.handle('desktop-host-action', async (event, action) => {
      const win = desktopWindow(event)
      if (action === 'fullscreen') {
        const next = !hostIsFullscreen(win)
        return changeHostFullscreen(win, next)
      }
      if (action === 'drag-start')
        win.fusionDrag = { cursor: screen.getCursorScreenPoint(), position: win.getPosition() }
      if ((action === 'drag-move' || action.startsWith('resize:')) && !hostIsFullscreen(win)) {
        clearInterval(win.fusionGestureTimer)
        const bounds = win.getBounds()
        const cursor = screen.getCursorScreenPoint()
        const edge = action.startsWith('resize:') ? action.slice(7) : ''
        win.fusionGestureTimer = setInterval(() => {
          if (win.isDestroyed()) {
            clearInterval(win.fusionGestureTimer)
            return
          }
          const point = screen.getCursorScreenPoint()
          const dx = point.x - cursor.x
          const dy = point.y - cursor.y
          if (!edge) {
            win.setPosition(bounds.x + dx, bounds.y + dy)
            return
          }
          let width = Math.max(240, bounds.width + (edge.includes('w') ? -dx : edge.includes('e') ? dx : 0))
          let height = Math.max(320, bounds.height + (edge.includes('n') ? -dy : edge.includes('s') ? dy : 0))
          if (store.get('desktopMode.desktopResizeMode') !== 'adaptive') {
            const ratio = win.fusionRatio || bounds.width / bounds.height
            if (edge === 'n' || edge === 's')
              width = Math.max(240, Math.round(height * ratio))
            else height = Math.max(320, Math.round(width / ratio))
          }
          win.setBounds({ x: edge.includes('w') ? bounds.x + bounds.width - width : bounds.x, y: edge.includes('n') ? bounds.y + bounds.height - height : bounds.y, width, height })
        }, 16)
      }
      if (action === 'drag-end') {
        clearInterval(win.fusionGestureTimer)
        win.fusionDrag = null
      }
      if (action === 'state')
        return hostIsFullscreen(win)
      if (action === 'close')
        win.close()
      if (action === 'restore') {
        win.restore()
        win.show()
        win.focus()
      }
      if (action === 'minimize') {
        if (hostIsFullscreen(win))
          await changeHostFullscreen(win, false)
        win.minimize()
      }
      return true
    })
    ipcMain.handle('desktop-device-session', (event, deviceId) => {
      const owner = ownerFor(event)
      deviceId = serial(deviceId)
      ensureTaskStream(owner, deviceId).catch(() => {})
      return ensureScreenSession(owner, deviceId)
    })
    ipcMain.handle('desktop-control-open', async (event, deviceId) => {
      const owner = ownerFor(event)
      owner.control = { deviceId: serial(deviceId), visible: true }
      return readPhoneState(owner.control.deviceId)
    })
    ipcMain.handle('desktop-control-state', (event) => {
      const owner = ownerFor(event)
      return owner.control?.visible ? readPhoneState(owner.control.deviceId) : null
    })
    ipcMain.handle('desktop-control-media', async (event, action) => {
      const owner = ownerFor(event)
      const keys = { previous: 88, toggle: 85, next: 87 }
      if (!owner.control?.visible || !Object.hasOwn(keys, action))
        throw new Error('媒体操作无效')
      await checkedShell(owner.control.deviceId, `input keyevent ${keys[action]}`)
      return true
    })
    ipcMain.handle('desktop-control-close', (event) => {
      ownerFor(event).control = null
      return true
    })
    ipcMain.handle('desktop-device-identity', async (event, deviceId) => {
      desktopWindow(event)
      deviceId = serial(deviceId)
      const aliases = store.get('androidDesktopIdentities') || {}
      try {
        const properties = await adb(deviceId, ['shell', 'getprop ro.serialno; getprop ro.boot.serialno'], { timeout: 4000 })
        const hardwareId = properties.split(/\r?\n/).map(value => value.trim()).find(value => /^[\w.-]{3,180}$/.test(value) && !/^(unknown|null|none)$/i.test(value))
        if (hardwareId) {
          store.set('androidDesktopIdentities', { ...aliases, [deviceId]: hardwareId })
          return { key: hardwareId }
        }
      }
      catch {}
      return { key: aliases[deviceId] || deviceId }
    })
    ipcMain.handle('desktop-device-connection', (event, deviceId) => {
      desktopWindow(event)
      return deviceConnection(deviceId)
    })
    ipcMain.handle('desktop-app-focus', async (event, id) => {
      const owner = ownerFor(event)
      if (owner.hostInput || !owner.sessions.has(id) || id === '__desktop_wallpaper__')
        return false
      return owner.bridge.request('focus', { appId: id })
    })
    ipcMain.handle('desktop-phone-command', (event, { deviceId, command }) => {
      desktopWindow(event)
      const allowed = new Set(['dumpsys notification --noredact'])
      if (!allowed.has(command))
        throw new Error('不支持此手机操作')
      return checkedShell(serial(deviceId), command)
    })
    ipcMain.handle(
      'desktop-control-action',
      async (event, { deviceId, key, enabled }) => {
        desktopWindow(event)
        deviceId = serial(deviceId)
        const commands = {
          rotation: `settings put system accelerometer_rotation ${enabled ? 0 : 1}`,
          location: `cmd location set-location-enabled ${enabled ? 'true' : 'false'}`,
          cellular: `svc data ${enabled ? 'enable' : 'disable'}`,
          wifi: `svc wifi ${enabled ? 'enable' : 'disable'}`,
          bluetooth: `cmd bluetooth_manager ${enabled ? 'enable' : 'disable'}`,
          airplane: `cmd connectivity airplane-mode ${
            enabled ? 'enable' : 'disable'
          }`,
          powerSave: `cmd power set-mode ${enabled ? 1 : 0}`,
          dark: `cmd uimode night ${enabled ? 'yes' : 'no'}`,
        }
        if (!Object.hasOwn(commands, key))
          throw new Error('不支持此系统开关')
        await checkedShell(deviceId, commands[key])
        await delay(200)
        return readPhoneState(deviceId)
      },
    )
    ipcMain.handle('desktop-host-input', (event, active) => focusDesktopInput(event, active !== false))
    ipcMain.handle('desktop-search-focus', event => focusDesktopInput(event))
    ipcMain.handle('desktop-catalog', async (event, deviceId) => {
      desktopWindow(event)
      return (await agent(serial(deviceId), 'apps')).apps
    })
    ipcMain.handle('desktop-device-battery', async (event, deviceId) => {
      desktopWindow(event)
      const output = await adb(serial(deviceId), ['shell', 'dumpsys battery'], {
        timeout: 4000,
      })
      const level = output.match(/^\s*level:\s*(\d+)/m)
      return level ? { level: Math.max(0, Math.min(100, Number(level[1]))), charging: /^\s*status:\s*(?:2|5)\s*$/m.test(output) && /^\s*(?:AC|USB|Wireless|Dock) powered:\s*true\s*$/im.test(output) } : null
    })
    ipcMain.handle('desktop-notification-action', (event, request) => {
      const owner = ownerFor(event)
      const deviceId = serial(request.deviceId)
      if (!['open', 'dismiss', 'clear'].includes(request.action))
        throw new Error('通知操作无效')
      const operation = async () => {
        const notices = await readPhoneNotifications(deviceId)
        const notice
          = request.action === 'clear'
            ? {}
            : notices.find(item => item.key === request.key)
        if (!notice)
          throw new Error('这条通知已移除，请刷新列表')
        if (request.action === 'dismiss' && !notice.dismissible)
          throw new Error('手机系统不允许移除此常驻通知')
        const displayId
          = [...owner.sessions.values()].find(
            session => session.packageName === notice.packageName,
          )?.displayId || 0
        const payload = Buffer.from(
          JSON.stringify({ ...notice, action: request.action, displayId }),
        ).toString('base64')
        return agent(deviceId, `notification-ui ${payload}`)
      }
      const result = notificationActionQueue.catch(() => {}).then(operation)
      notificationActionQueue = result.catch(() => {})
      return result
    })
    ipcMain.handle(
      'desktop-notification-attach',
      async (event, { packageName, taskId }) => {
        const owner = ownerFor(event)
        const session = [...owner.sessions.values()].find(
          item => item.packageName === packageName,
        )
        if (!session?.displayId || !Number.isInteger(taskId) || taskId <= 0)
          return false
        return agent(
          session.deviceId,
          `notification-attach ${Buffer.from(JSON.stringify({ taskId, displayId: session.displayId })).toString('base64')}`,
        )
      },
    )
    ipcMain.handle('desktop-notifications', async (event, deviceId) => {
      desktopWindow(event)
      return readPhoneNotifications(serial(deviceId))
    })
    ipcMain.handle('desktop-device-state', async (event, deviceId) => {
      desktopWindow(event)
      return readPhoneState(serial(deviceId))
    })
    ipcMain.handle(
      'desktop-device-level',
      async (event, { deviceId, kind, value }) => {
        desktopWindow(event)
        if (
          !['volume', 'brightness'].includes(kind)
          || !Number.isFinite(Number(value))
        ) {
          throw new Error('控制参数无效')
        }
        const percent = Math.max(0, Math.min(100, Math.round(Number(value))))
        deviceId = serial(deviceId)
        if (kind === 'volume')
          return agent(deviceId, `volume ${percent}`)
        await checkedShell(
          deviceId,
          'settings put system screen_brightness_mode 0',
        )
        await delay(120)
        return agent(deviceId, `brightness ${percent}`)
      },
    )
    ipcMain.handle('desktop-wallpaper-stop', (event) => {
      stopWallpaper(ownerFor(event))
      return true
    })
    ipcMain.on('desktop-wallpaper-ack', (event, sequence) => {
      const owner = owners.get(event.sender.id)
      const state = owner?.wallpaper
      if (state && state.awaiting === sequence) {
        state.awaiting = 0
        pumpWallpaper(owner)
      }
    })
    ipcMain.on('desktop-wallpaper-visible', (event, visible) => {
      const owner = owners.get(event.sender.id)
      if (owner) {
        owner.wallpaperHidden = !visible
        pauseWallpaper(owner)
      }
    })
    ipcMain.handle('desktop-wallpaper-follow', async (event, request) => {
      const owner = ownerFor(event)
      const deviceId = serial(
        typeof request === 'string' ? request : request.deviceId,
      )
      const fit
        = typeof request === 'object' && request.fit === 'contain'
          ? 'contain'
          : 'cover'
      const info = await agent(deviceId, 'wallpaper-info')
      if (info.live && request.mode !== 'static')
        return streamWallpaper(owner, deviceId, fit)
      stopWallpaper(owner)
      let result
      try {
        result = await agent(
          deviceId,
          info.live ? 'wallpaper-snapshot' : 'wallpaper',
        )
      }
      catch {
        result = await agent(deviceId, 'wallpaper-snapshot')
      }
      return { live: false, image: result.image }
    })
    ipcMain.handle('desktop-wallpaper-phone', async (event, deviceId) => {
      desktopWindow(event)
      try {
        return (await agent(serial(deviceId), 'wallpaper')).image
      }
      catch {
        throw new Error(
          '手机系统未允许 ADB 读取当前壁纸。可以先在手机导出壁纸，再选择本地图片；动态壁纸不能直接同步。',
        )
      }
    })
    ipcMain.handle('desktop-wallpaper-pick', async (event) => {
      const win = desktopWindow(event)
      const result = await dialog.showOpenDialog(win, {
        title: '选择桌面壁纸',
        properties: ['openFile'],
        filters: [
          { name: '图片', extensions: ['jpg', 'jpeg', 'png', 'webp', 'bmp'] },
        ],
      })
      if (result.canceled || !result.filePaths[0])
        return null
      let image = nativeImage.createFromPath(result.filePaths[0])
      if (image.isEmpty())
        throw new Error('无法读取这张图片')
      const size = image.getSize()
      if (Math.max(size.width, size.height) > 2560) {
        image
          = size.width >= size.height
            ? image.resize({ width: 2560 })
            : image.resize({ height: 2560 })
      }
      return `data:image/jpeg;base64,${image.toJPEG(85).toString('base64')}`
    })
    ipcMain.handle('desktop-app-open', async (event, request) => {
      const owner = ownerFor(event)
      if (owner.opening.has(request.id))
        return owner.opening.get(request.id)
      const opening = startSession(owner, request)
      owner.opening.set(request.id, opening)
      try {
        return await opening
      }
      finally {
        owner.opening.delete(request.id)
      }
    })
    ipcMain.handle('desktop-app-close', (event, id) => {
      closeSession(ownerFor(event), id)
      return true
    })
    ipcMain.handle(
      'desktop-app-right-button',
      async (event, { id, enabled }) => {
        const owner = ownerFor(event)
        const session = owner.sessions.get(id)
        if (!session)
          throw new Error('应用窗口已关闭')
        await owner.bridge.ready
        if (
          enabled
          && (!owner.bridge.mouseAvailable
            || !session.displayId
            || session.displayId <= 0)
        ) {
          throw new Error('尚未准备好此应用的右键返回，请稍后再试')
        }
        await owner.bridge.request('right-button', {
          appId: id,
          enabled: Boolean(enabled),
        })
        session.rightBack = Boolean(enabled)
        return session.rightBack
      },
    )
    ipcMain.handle('desktop-device-layout', (event, deviceId) => {
      desktopWindow(event)
      return deviceLayout(deviceId)
    })
    ipcMain.handle('desktop-app-resolution', async (event, { id, config }) => {
      const owner = ownerFor(event)
      const session = owner.sessions.get(id)
      if (!session)
        throw new Error('应用窗口已关闭')
      if (session.displayId === null || session.displayId <= 0)
        throw new Error('尚未读到这个应用的虚拟显示器编号，请稍后再试')
      const next
        = config.layout === 'device'
          ? await deviceLayout(session.deviceId)
          : displaySpec(config)
      const previous = session.config
      const run = command => adb(session.deviceId, ['shell', command])
      const check = (output) => {
        if (/error|exception|unknown|invalid/i.test(output))
          throw new Error(output.trim())
      }
      try {
        check(
          await run(
            `wm size ${next.width}x${next.height} -d ${session.displayId}`,
          ),
        )
        check(await run(`wm density ${next.dpi} -d ${session.displayId}`))
      }
      catch (error) {
        await run(
          `wm size ${previous.width}x${previous.height} -d ${session.displayId}`,
        ).catch(() => {})
        await run(`wm density ${previous.dpi} -d ${session.displayId}`).catch(
          () => {},
        )
        throw new Error(`手机不支持在线调整此虚拟显示器：${error.message}`)
      }
      session.config = next
      return next
    })
    ipcMain.on('desktop-app-layout', (event, layout) => {
      try {
        if (!Array.isArray(layout) || layout.length > 13)
          return
        const owner = ownerFor(event)
        owner.layout = layout
        syncLayout(owner)
      }
      catch (error) {
        console.warn('desktop layout', error.message)
      }
    })
    app.once('before-quit', () => {
      for (const owner of owners.values()) {
        stopScreenSession(owner)

        stopTaskStream(owner)
        owner.closed = true
        owner.phoneMirror?.kill()
        stopWallpaper(owner)
        clearInterval(owner.focusTimer)
        for (const id of owner.sessions.keys()) closeSession(owner, id)
        owner.audio?.kill()
        owner.bridge.close()
      }
    })
  },
}
