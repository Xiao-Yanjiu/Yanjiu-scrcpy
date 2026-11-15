import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { createNotificationTracker } from '../../electron/modules/desktop/notification-tracker.js'

const source = readFileSync(new URL('../../electron/modules/desktop/window.js', import.meta.url), 'utf8')
let clock = 0
let sequence = 0
const intervals = new Map()
const timers = new Map()
const sent = []
class FakeWindow {
  constructor(bounds) {
    this.bounds = bounds
    this.webContents = { setWindowOpenHandler() {}, on: (name, callback) => {
      this[name] = callback
    } }
  }

  async loadURL() {}
  getBounds() { return this.bounds }
  setPosition(x, y) { Object.assign(this.bounds, { x, y }) }
  showInactive() {}
  isDestroyed() { return !!this.destroyed }
  destroy() { this.destroyed = true }
}
const script = source.slice(source.indexOf('const nextDesktopNotification'), source.indexOf('const floatingTargets'))
const api = runInNewContext(`${script}\n({show:showDesktopNotification,clear:dismissDesktopNotification,cards:notificationCards,queue:notificationQueue})`, {
  createNotificationTracker,
  BrowserWindow: FakeWindow,
  app: { bossHidden: false },
  store: { get: () => ({ wifi: 'phone', usb: 'phone' }) },
  screen: { getCursorScreenPoint: () => ({ x: 0, y: 0 }), getDisplayNearestPoint: () => ({ workArea: { x: 0, y: 0, width: 1000, height: 500 } }) },
  Date: { now: () => clock },
  setInterval: (callback) => {
    const id = ++sequence
    intervals.set(id, callback)
    return id
  },
  clearInterval: id => intervals.delete(id),
  setTimeout: (callback) => {
    const id = ++sequence
    timers.set(id, callback)
    return id
  },
  clearTimeout: id => timers.delete(id),
  queueMicrotask,
  console,
})
const owner = { fusionDeviceId: 'usb', isDestroyed: () => false, webContents: { send: (...args) => sent.push(args) } }
await api.show({ owner, notices: [], background: true })
const notices = Array.from({ length: 5 }, (_, id) => ({ key: String(id), title: 'Chat', text: String(id) }))
await api.show({ owner, notices, background: true })
assert.equal(api.cards.length, 3, 'only the screen capacity is visible')
assert.equal(api.queue.length, 2, 'extra messages are queued, never overwritten')
clock += 200
for (const callback of [...intervals.values()]) callback()
assert.deepEqual(Array.from(api.cards, item => item.win.getBounds().y), [124, 248, 372], 'older cards rise and newest stays at bottom')
const first = api.cards[0]
first.win['will-navigate']({ preventDefault() {} }, 'yanjiu-notification:open')
await new Promise(resolve => setImmediate(resolve))
assert.equal(sent[0][1].text, '0', 'each card opens its own notification app')
assert.equal(api.cards.length, 3)
assert.equal(api.queue.length, 1)
api.clear()
assert.equal(api.cards.length, 0)
assert.equal(api.queue.length, 0)
assert.equal(timers.size, 0)
assert.equal(intervals.size, 0)
console.log('PASS: stack order, capacity queue, click target, boss-key cleanup and timers')
