import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'

const source = readFileSync(new URL('../../pages/desktop/App.vue', import.meta.url), 'utf8')
const start = source.indexOf('async function openNotification(notice) {')
const end = source.indexOf('function pauseBanner', start)
const launches = []
const notificationBusy = { value: '' }
const run = runInNewContext(`(${source.slice(start, end).trim()})`, {
  notificationBusy,
  isFusion: true,
  apps: { value: [{ packageName: 'test.app', name: 'Test', icon: 'icon' }] },
  launch: async app => launches.push(app),
  window: { $preload: { ipcRenderer: { invoke() { throw new Error('Desktop click must not operate the phone shade') } } } },
  notify: message => assert.fail(message),
})
await run({ key: 'notice', packageName: 'test.app', appName: 'Test' })
assert.equal(launches.length, 1)
assert.equal(launches[0].packageName, 'test.app')
assert.equal(notificationBusy.value, '')
console.log('PASS: desktop notification opens the app directly without phone-shade IPC')
