import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'

const source = fs.readFileSync(new URL('../../electron/modules/desktop/embed.js', import.meta.url), 'utf8')
const start = source.indexOf('async function syncAndroidInputFocus(')
const end = source.indexOf('\n}', start) + 2
const commands = []
const stream = { sequence: 0, pending: new Map(), child: { stdin: { write(line) {
  const command = JSON.parse(line)
  commands.push(command)
  const pending = stream.pending.get(command.id)
  clearTimeout(pending.timer)
  stream.pending.delete(command.id)
  pending.resolve({ focused: true })
} } } }
const state = new Map()
const context = vm.createContext({ Symbol, Promise, setTimeout, clearTimeout, Buffer,
  latestInputIntent: new Map(), deviceInputFocus: state,
  ensureTaskStream: async (owner) => { owner.tasks = stream },
  recordAppUsage() {}, sessionLog() {},
})
vm.runInContext(source.slice(start, end), context)
const owner = { sessions: new Map(), hostInput: false }
owner.sessions.set('app', { deviceId: 'test', displayId: 12, packageName: 'test.app' })
owner.sessions.set('mirror', { deviceId: 'test', displayId: 0, packageName: '', mirror: true })
assert.equal(await context.syncAndroidInputFocus(owner, 'app'), true)
owner.hostInput = true // Launcher search must not block the independent mirror.
assert.equal(await context.syncAndroidInputFocus(owner, 'mirror'), true)
owner.hostInput = false
assert.equal(await context.syncAndroidInputFocus(owner, 'app'), true)
assert.deepEqual(commands.map(command => command.displayId), [12, 0, 12])
assert.equal(state.get('test').key, '12:test.app')
console.log('PASS app -> mirror -> app focus and launcher editor isolation')
