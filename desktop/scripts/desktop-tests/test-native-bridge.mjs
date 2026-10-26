import assert from 'node:assert/strict'
import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const run = promisify(execFile)
const here = path.dirname(fileURLToPath(import.meta.url))
const helper
  = process.argv[2]
    || path.resolve(here, '../../electron/resources/extra/win/desktop-window.ps1')
const fixture = path.join(here, 'test-native-window.ps1')
const children = []
const pending = new Map()
let sequence = 0
let bridge

async function host(title) {
  const child = spawn(
    'powershell.exe',
    [
      '-NoProfile',
      '-STA',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      fixture,
      '-Title',
      title,
    ],
    { windowsHide: true },
  )
  children.push(child)
  const lines = createInterface({ input: child.stdout })
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('Test host did not start')),
      10000,
    )
    lines.on('line', (line) => {
      try {
        const info = JSON.parse(line)
        if (info.handle) {
          clearTimeout(timer)
          resolve(info)
        }
      }
      catch {}
    })
    child.on('error', reject)
  })
}

async function request(command, data = {}) {
  const id = ++sequence
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id)
      reject(new Error(`Bridge timeout: ${command}`))
    }, 8000)
    pending.set(id, { resolve, reject, timer })
    bridge.stdin.write(`${JSON.stringify({ id, command, ...data })}\n`)
  })
}

async function probe(handle) {
  const { stdout } = await run(
    'powershell.exe',
    [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      fixture,
      '-Mode',
      'probe',
      '-Handle',
      String(handle),
    ],
    { windowsHide: true },
  )
  return JSON.parse(stdout.trim())
}

try {
  const parent = await host('Desktop Bridge Test Parent')
  const child = await host('Desktop Bridge Test Child')
  bridge = spawn(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      helper,
      '-ParentHandle',
      String(parent.handle),
    ],
    { windowsHide: true },
  )
  children.push(bridge)
  const reader = createInterface({ input: bridge.stdout })
  await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('Bridge did not initialize')),
      10000,
    )
    reader.on('line', (line) => {
      const message = JSON.parse(line)
      if (message.ready) {
        clearTimeout(timer)
        resolve()
        return
      }
      const entry = pending.get(message.id)
      if (!entry)
        return
      clearTimeout(entry.timer)
      pending.delete(message.id)
      message.error
        ? entry.reject(new Error(message.error))
        : entry.resolve(message.result)
    })
  })
  assert.equal(
    await request('attach', {
      appId: 'child',
      pid: child.pid,
      title: 'Wrong Window',
    }),
    false,
  )
  assert.equal(
    await request('attach', {
      appId: 'child',
      pid: child.pid,
      title: 'Desktop Bridge Test Child',
    }),
    true,
  )
  const layout = {
    id: 'child',
    x: 20,
    y: 60,
    width: 500,
    height: 300,
    visible: true,
    clips: [{ x: 100, y: 80, width: 100, height: 60 }],
  }
  await request('sync', { windows: [layout] })
  const first = await probe(child.handle)
  assert.equal(first.parent, parent.handle, 'app must belong to desktop HWND')
  assert.equal(
    first.child,
    true,
    'app must use WS_CHILD rather than an independent window',
  )
  assert.equal(first.width, 500)
  assert.equal(first.height, 300)
  assert.equal(first.visible, true)
  assert.equal(first.normalPoint, true)
  assert.equal(
    first.coveredPoint,
    false,
    'overlay must cut a hole in native video',
  )
  const started = performance.now()
  for (let index = 0; index < 60; index++) {
    await request('sync', {
      windows: [{ ...layout, width: 600, height: 400, x: 20 + index }],
    })
  }
  const elapsed = performance.now() - started
  assert.ok(elapsed < 6000, `60 layout commands took ${elapsed}ms`)
  const resized = await probe(child.handle)
  assert.equal(resized.width, 600)
  assert.equal(resized.height, 400)
  await request('sync', { windows: [{ ...layout, visible: false }] })
  assert.equal((await probe(child.handle)).visible, false)
  await request('forget', { appId: 'child' })
  console.log(
    JSON.stringify({
      passed: true,
      checks: [
        'exact window selection',
        'embedded parent',
        'frameless child',
        'resize',
        'overlay clipping',
        'hide',
        'persistent IPC',
      ],
      layoutCommands: 60,
      elapsedMs: Math.round(elapsed),
    }),
  )
}
finally {
  for (const entry of pending.values()) {
    clearTimeout(entry.timer)
    entry.reject(new Error('Test complete'))
  }
  for (const child of children.reverse()) {
    child.stdin?.end()
    child.kill()
  }
}
