import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { EventEmitter } from 'node:events'

const source = fs.readFileSync(new URL('../../electron/modules/desktop/embed.js', import.meta.url), 'utf8')
const component = fs.readFileSync(new URL('../../pages/desktop/App.vue', import.meta.url), 'utf8')
const extract = (text, from, to) => text.slice(text.indexOf(from), text.indexOf(to))

// Failed editor->SDL transitions must be retryable; an older queued transition
// must never disable the child after a newer app-focus request.
const calls = []
let fail = true
const owner = {
  sessions: new Map(),
  bridge: { async request(command, value) {
    calls.push([command, value.active])
    if (fail) {
      fail = false
      throw new Error('simulated timeout')
    }
    return true
  } },
}
let focused = 0
const context = vm.createContext({
  owners: new Map([[1, owner]]),
  desktopWindow: () => ({ focusOnWebView() { focused++ }, webContents: { focus() {} } }),
})
vm.runInContext(extract(source, 'async function focusDesktopInput(', 'async function confirmAppInputFocus('), context)
const event = { sender: { id: 1 } }
await assert.rejects(context.focusDesktopInput(event, true), /timeout/)
assert.equal(owner.hostInput, false)
assert.equal(await context.focusDesktopInput(event, true), true)
assert.equal(focused, 1)
const first = context.focusDesktopInput(event, true)
const last = context.focusDesktopInput(event, false)
assert.equal(await first, false)
assert.equal(await last, true)
assert.equal(owner.hostInput, false)
assert.deepEqual(calls.at(-1), ['host-input', false])

// Renderer must retry the same requested state after a rejected IPC.
let attempts = 0
const renderer = vm.createContext({ window: { $preload: { ipcRenderer: { invoke: async () => {
  attempts++
  if (attempts === 1)
    throw new Error('lost IPC')
  return true
} } } } })
vm.runInContext(`const hostInputActive={value:false};let hostFocusPending=null;let hostFocusGeneration=0;let hostInputConfirmed=null;${
  extract(component, 'function requestHostInput(', 'function searchKeydown(')}`, renderer)
assert.equal(await renderer.requestHostInput(true), false)
assert.equal(await renderer.requestHostInput(true), true)
assert.equal(attempts, 2)
await renderer.requestHostInput(true)
assert.equal(attempts, 2)

// Desktop clipboard receives events only, coalesces a burst, and never rewrites
// identical PC text (which would discard formats and trigger clipboard history).
const timers = []
const writes = []
let reads = 0
const clip = vm.createContext({
  Buffer,
  setTimeout(fn) {
    timers.push(fn)
    return timers.length
  },
  clipboard: {
    readText() {
      reads++
      return 'same'
    },
    writeText(text) { writes.push(text) },
  },
  sessionLog() { throw new Error('unexpected clipboard error') },
})
vm.runInContext(`let pendingPhoneClipboard=null;let clipboardWriteTimer=null;${
  extract(source, 'function queuePhoneClipboard(', 'function ensureClipboardRelay(')}`, clip)
assert.equal(reads, 0)
clip.queuePhoneClipboard('same')
timers.shift()()
assert.equal(writes.length, 0)
clip.queuePhoneClipboard('first')
clip.queuePhoneClipboard('last')
assert.equal(timers.length, 1)
timers.shift()()
assert.deepEqual(writes, ['last'])

// Background notification polling must not ask the SystemUI main service for
// shade state; concurrent callers share one notification snapshot.
const commands = []
let release
const notices = vm.createContext({
  notificationReads: new Map(), notificationDetails: new Map(), notificationApps: new Map(),
  adb: async (_id, args) => {
    commands.push(args.join(' '))
    return new Promise((resolve) => {
      release = resolve
    })
  },
  parsePhoneNotifications: () => [],
  globalEventEmitter: { emit() {} },
})
vm.runInContext(extract(source, 'function readPhoneNotifications(', 'async function deviceLayout('), notices)
const a = notices.readPhoneNotifications('phone', false)
const b = notices.readPhoneNotifications('phone', false)
assert.equal(a, b)
release('')
await a
assert.deepEqual(commands, ['shell dumpsys notification --noredact'])
console.log('PASS host-input timeout recovery, stale transition cancellation, renderer retry, clipboard event coalescing/echo suppression, background notification coalescing')

// Concurrent mirror clicks share the entire preparation, not only renderer ready.
let mirrorHandler
let preparations = 0
let finishPreparation
let relayCalls = 0
const mirrorOwner = { win: {}, sessions: new Map() }
const mirrorContext = vm.createContext({
  ipcMain: { handle(_name, handler) { mirrorHandler = handler } },
  app: {}, ownerFor: () => mirrorOwner, serial: value => value,
  store: { get: () => ({}) }, getScrcpy: () => 'scrcpy',
  desktopServer: () => {
    preparations++
    return new Promise((resolve) => {
      finishPreparation = resolve
    })
  },
  ensureClipboardRelay: async () => { relayCalls++ },
  spawn: () => { throw new Error('must not spawn after desktop closes') },
})
vm.runInContext(extract(source, '    ipcMain.handle(\'desktop-phone-mirror\'', '    ipcMain.handle(\'desktop-fusion-launcher\''), mirrorContext)
const mirrorA = mirrorHandler({}, 'phone')
const mirrorB = mirrorHandler({}, 'phone')
const results = Promise.allSettled([mirrorA, mirrorB])
assert.equal(preparations, 1)
mirrorOwner.closed = true
finishPreparation('server')
for (const result of await results) {
  assert.equal(result.status, 'rejected')
  assert.match(result.reason.message, /桌面窗口已关闭/)
}
assert.equal(relayCalls, 1)
assert.equal(mirrorOwner.mirrorOpening, null)
console.log('PASS concurrent mirror startup and close-during-preparation')

// Broken native pipes reject outstanding and later requests immediately.
const bridgeTimers = new Map()
let timerId = 0
let bridgeChild
let bridgeReader
const bridgeContext = vm.createContext({
  Buffer, process: { platform: 'win32' }, extraResolve: value => value,
  sessionLog() {},
  setTimeout(fn) {
    bridgeTimers.set(++timerId, fn)
    return timerId
  },
  clearTimeout(id) { bridgeTimers.delete(id) },
  spawn: () => {
    bridgeChild = new EventEmitter()
    bridgeChild.stdin = Object.assign(new EventEmitter(), { write() {}, end() {} })
    bridgeChild.stdout = new EventEmitter()
    bridgeChild.stderr = new EventEmitter()
    bridgeChild.exitCode = null
    bridgeChild.kill = () => {
      bridgeChild.killed = true
    }
    return bridgeChild
  },
  createInterface: () => {
    bridgeReader = Object.assign(new EventEmitter(), { close() {} })
    return bridgeReader
  },
})
vm.runInContext(`${extract(source, 'class NativeBridge {', 'function stopWallpaper(')};globalThis.Bridge=NativeBridge`, bridgeContext)
const bridge = new bridgeContext.Bridge({ getNativeWindowHandle: () => Buffer.alloc(8) })
bridgeReader.emit('line', '{"ready":true}')
const pendingBridge = bridge.request('active')
const rejectedBridge = assert.rejects(pendingBridge, /broken pipe/)
await Promise.resolve()
bridgeChild.stdin.emit('error', new Error('broken pipe'))
await rejectedBridge
await assert.rejects(bridge.request('active'), /broken pipe/)
assert.equal(bridge.pending.size, 0)
assert.equal(bridgeTimers.size, 0)
bridge.close()
assert.equal(bridgeChild.killed, true)
console.log('PASS native bridge pipe failure cleanup and fast rejection')

// A window destroyed during an awaited focus poll must not reject the timer.
let poll
let pollErrors = 0
const pollOwner = { sessions: new Map([['app', {}]]), bridge: { request: async () => '' } }
const polling = vm.createContext({
  owner: pollOwner, app: {}, process: { platform: 'win32' },
  win: { fusionRole: 'app', isVisible() { throw new Error('Object has been destroyed') } },
  setInterval(fn) { poll = fn },
  sessionLog() { pollErrors++ },
})
vm.runInContext(extract(source, '  owner.focusTimer = setInterval(', '  for (const name of [\'hide\''), polling)
await poll()
assert.equal(pollOwner.focusChecking, false)
assert.equal(pollErrors, 1)
console.log('PASS destroyed-window focus poll containment')
