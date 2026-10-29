import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import vm from 'node:vm'

const source = fs.readFileSync(new URL('../../electron/modules/desktop/window.js', import.meta.url), 'utf8')
let id = 0
const created = []
class Window extends EventEmitter {
  constructor(options = {}) {
    super()
    this.options = options
    this.bounds = { x: 0, y: 0, width: 80, height: 80 }
    this.webContents = Object.assign(new EventEmitter(), { id: ++id, send() {}, setWindowOpenHandler() {} })
    created.push(this)
  }

  isDestroyed() { return !!this.destroyed }
  isFullScreen() { return !!this.fullscreen }
  isVisible() { return !!this.visible }
  isMinimized() { return false }
  getBounds() { return this.bounds }
  setBounds(value) { this.bounds = value }
  setPosition(x, y) { Object.assign(this.bounds, { x, y }) }
  setAlwaysOnTop(value, level) { this.topmost = [value, level] }
  moveTop() { this.raised = (this.raised || 0) + 1 }
  setShape() {}
  hide() { this.visible = false }
  showInactive() { this.visible = true }
  async loadURL(html) { this.html = decodeURIComponent(html.split(',').slice(1).join(',')) }
  destroy() {
    this.destroyed = true
    this.emit('closed')
  }
}
const emitter = new EventEmitter()
const store = new Map()
const app = {}
const context = vm.createContext({
  BrowserWindow: Window, globalEventEmitter: emitter, app,
  store: { get: key => store.get(key), set: (key, value) => store.set(key, value) },
  screen: { getPrimaryDisplay: () => ({ workArea: { x: 0, y: 0, width: 1200, height: 900 } }), getDisplayMatching: () => ({ bounds: { x: 0, y: 0, width: 1200, height: 900 } }) },
  process: { platform: 'win32' }, nativeImage: {}, trayPath: '', console,
})
const start = source.indexOf('const fullscreenControls = new Map()')
const end = source.indexOf('async function animateWindow(')
vm.runInContext(`${source.slice(start, end).replace('export function registerFloatingTarget', 'function registerFloatingTarget')};globalThis.controls=fullscreenControls`, context)
const host = new Window()
host.fullscreen = host.visible = true
context.attachFullscreenControl(host)
host.emit('enter-full-screen')
await new Promise(resolve => setImmediate(resolve))
const control = created.at(-1)
assert.equal(control.options.transparent, true)
assert.equal(control.options.backgroundColor, '#00000000')
assert.equal(control.options.hasShadow, false)
assert.equal(control.options.parent, host)
assert.equal(control.visible, true)
assert.match(control.html, /background:transparent!important/)
assert.equal(control.options.width, 80)
assert.equal(control.options.height, 80)
const actions = context.controls.get(control.webContents.id)
actions.move(0, 5000)
actions.save()
assert.equal(control.bounds.x, 0)
assert.equal(control.bounds.y, 820)
assert.equal(store.get('fullscreenControlPosition').side, 'left')
app.bossHidden = true
emitter.emit('boss:visibility', true)
assert.equal(control.visible, false)
app.bossHidden = false
emitter.emit('boss:visibility', false)
await new Promise(resolve => setImmediate(resolve))
assert.equal(control.visible, true)
host.fullscreen = false
host.emit('leave-full-screen')
assert.equal(control.visible, false)
host.destroy()
assert.equal(context.controls.size, 0)
const target = context.registerFloatingTarget({ icon: 'data:image/png;base64,', isMinimized: () => true, restore() {} })
await target.update()
const bubble = target.bubble
const raised = bubble.raised
await target.update()
assert.equal(bubble.raised, raised + 1)
assert.deepEqual(bubble.topmost, [true, 'screen-saver'])
assert.equal(bubble.options.focusable, false)
target.dispose()
console.log('PASS transparent fullscreen control lifecycle/drag bounds/boss hide; mirror bubble reasserts top order without focus')
