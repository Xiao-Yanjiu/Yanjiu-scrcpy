import assert from 'node:assert/strict'
import { createDeviceLister, parseDeviceList } from '../../electron/middleware/adb/helpers/device-list.js'

const output = 'List of devices attached\nusb device product:phone model:Phone device:phone transport_id:1\nwifi:5555 device model:Phone\nlocked unauthorized\ngone offline\n'
assert.equal(parseDeviceList(output).length, 4)
const calls = []
const list = createDeviceLister(async (args, timeout) => {
  calls.push({ args, timeout })
  if (args[0] === 'devices')
    return { stdout: output }
  if (args[1] === 'wifi:5555')
    throw new Error('shell timed out')
  return { stdout: 'serial\nserial\nPhysical size: 1080x2400\nOverride size: 900x2000' }
})
const [first, second] = await Promise.all([list(), list()])
assert.equal(first, second, 'share concurrent refresh')
assert.equal(first[0].serialNo, 'serial')
assert.equal(first[0].screenWidth, 900)
assert.equal(first[1].id, 'wifi:5555', 'a metadata timeout must not hide the device')
assert.equal(first[2].type, 'unauthorized')
assert.equal(first[3].type, 'offline', 'offline USB must remain visible')
assert.equal(calls.filter(call => call.args[0] === 'devices').length, 1)
assert.ok(calls.every(call => call.timeout > 0 && call.timeout <= 5000))
assert.ok(!calls.some(call => call.args[1] === 'locked'), 'never query unauthorized phone metadata')
let fail = true
const retry = createDeviceLister(async () => {
  if (fail)
    throw new Error('failed to start daemon')
  return { stdout: 'List of devices attached\n' }
})
await assert.rejects(retry(), /failed to start daemon/)
fail = false
assert.deepEqual(await retry(), [], 'failed refresh may be retried without stuck pending state')
console.log('PASS: bounded reads, concurrent refresh, metadata timeout fallback, unauthorized device and recovery')
