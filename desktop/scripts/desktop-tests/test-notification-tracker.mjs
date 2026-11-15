import assert from 'node:assert/strict'
import { createNotificationTracker } from '../../electron/modules/desktop/notification-tracker.js'

const next = createNotificationTracker()
const notice = { key: '0|app|1', title: 'Title', text: 'Message', postTime: 1 }
assert.deepEqual(next('phone', []), [])
assert.deepEqual(next('phone', [notice]), [notice])
assert.deepEqual(next('phone', [{ ...notice, postTime: 2 }]), [], 'timestamp-only updates must not repeat')
assert.deepEqual(next('phone', [notice]), [], 'the same phone on another transport must not repeat')
const changed = { ...notice, text: 'New message' }
assert.deepEqual(next('phone', [changed]), [changed])
assert.deepEqual(next('another-phone', [notice]), [], 'new device snapshot is seeded silently')
assert.deepEqual(next('phone', []), [])
const reposted = { ...notice, postTime: 3 }
assert.deepEqual(next('phone', [reposted]), [reposted], 'a removed notification may arrive again with a new post time')
console.log('PASS: duplicate transport and timestamp updates suppressed; new content still displayed')

const batch = createNotificationTracker()
batch('phone', [])
const burst = [1, 2, 3].map(id => ({ key: String(id), title: 'Chat', text: String(id) }))
assert.deepEqual(batch('phone', burst), burst, 'all changed notices must be returned')
console.log('PASS: a batch returns all notifications, not only its first item')

const dual = createNotificationTracker()
dual('phone', [])
const one = { key: 'chat', text: 'one', postTime: 1 }
const two = { key: 'chat', text: 'two', postTime: 2 }
assert.deepEqual(dual('phone', [one]), [one])
assert.deepEqual(dual('phone', [two]), [two])
assert.deepEqual(dual('phone', [one]), [], 'delayed second transport cannot replay old message')
assert.deepEqual(dual('phone', [two]), [], 'delayed second transport cannot replay newest message')
