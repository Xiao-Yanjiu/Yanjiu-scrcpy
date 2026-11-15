import assert from 'node:assert/strict'
import { EventEmitter, once } from 'node:events'
import { createServer } from 'node:net'
import { setTimeout as delay } from 'node:timers/promises'
import { createNotificationRelay, notificationCompanionInstalled } from '../../electron/modules/desktop/notification-relay.js'

function owner() {
  const value = new EventEmitter()
  value.isDestroyed = () => false
  return value
}
const calls = []
let peer
const server = createServer((socket) => {
  peer = socket
  socket.on('error', () => {})
  socket.write(`${JSON.stringify({ type: 'snapshot', notices: [] })}\n`)
})
server.listen(0, '127.0.0.1')
await once(server, 'listening')
const port = server.address().port
const modes = []
const snapshots = []
const relay = createNotificationRelay({
  async adb(device, args) {
    calls.push([device, args])
    if (args[0] === 'shell')
      return 'package:dev.yanjiu.scrcpy.notifications'
    if (args[1] === 'tcp:0')
      return String(port)
    return ''
  },
  sourceChanged(win, active) { modes.push([win, active]) },
  publish(win, notices) { snapshots.push([win, notices]) },
})
try {
  const first = owner()
  const second = owner()
  assert.deepEqual(await relay.read(first, 'phone'), [])
  await relay.read(second, 'phone')
  const connectedCalls = calls.length
  for (let index = 0; index < 5; index++) await relay.read(first, 'phone')
  assert.equal(calls.length, connectedCalls, 'live relay must not poll ADB')
  assert.equal(calls.filter(([, args]) => args[1] === 'tcp:0').length, 1, 'windows share one forward')
  peer.write(`${JSON.stringify({ type: 'snapshot', notices: [{ key: 'n1', packageName: 'test.app', text: 'message' }] })}\n`)
  await delay(40)
  assert.equal(snapshots.at(-1)[1][0].key, 'n1')
  assert.equal((await relay.read(first, 'phone'))[0].text, 'message')
  const beforeBurst = snapshots.length
  for (const text of ['first', 'second', 'third'])
    peer.write(`${JSON.stringify({ type: 'posted', notice: { key: 'n1', packageName: 'test.app', text } })}\n`)
  await delay(40)
  assert.deepEqual(snapshots.slice(beforeBurst).filter(([win]) => win === first).map(([, list]) => list[0].text), ['first', 'second', 'third'], 'preserve each update of the same notification key')

  first.emit('closed')
  assert.equal(calls.filter(([, args]) => args[1] === '--remove').length, 0)
  peer.destroy()
  await delay(40)
  assert.equal(modes.at(-1)[1], false, 'disconnect resumes fallback')
  assert.equal(await relay.read(second, 'phone'), null)
  second.emit('closed')
  assert.equal(calls.filter(([, args]) => args[1] === '--remove').length, 1, 'remove only owned forward')
}
finally {
  relay.close()
  peer?.destroy()
  server.close()
}
let checks = 0
const missing = createNotificationRelay({
  async adb() {
    checks++
    return ''
  },
  sourceChanged() {}, publish() {},
})
const noApp = owner()
assert.equal(await missing.read(noApp, 'no-helper'), null)
assert.equal(await missing.read(noApp, 'no-helper'), null)
assert.equal(checks, 1, 'missing package checks are cached, not repeated each poll')
noApp.emit('closed')
missing.close()
console.log('PASS: live snapshots, shared transport, no idle ADB reads, disconnect fallback and cleanup')

assert.equal(await notificationCompanionInstalled(async () => '', 'phone'), false)
assert.equal(await notificationCompanionInstalled(async () => 'package:dev.yanjiu.scrcpy.notifications.other', 'phone'), false)
assert.equal(await notificationCompanionInstalled(async () => 'package:dev.yanjiu.scrcpy.notifications\r\n', 'phone'), true)
await assert.rejects(notificationCompanionInstalled(async () => {
  throw new Error('device offline')
}, 'phone'), /device offline/)
console.log('PASS: package detection handles missing package and preserves ADB transport errors')
