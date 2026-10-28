import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { once } from 'node:events'

// Runs the actual packaged executable minimized, without screen automation.
const executable = path.resolve(process.argv[2] || '')
assert.ok(executable.endsWith('.exe'), 'Pass the packaged Windows executable path')
const env = { ...process.env, ELECTRON_ENABLE_LOGGING: '1' }
for (const key of ['ELECTRON_RUN_AS_NODE', 'YANJIU_SOURCE_ROOT', 'PORTABLE_EXECUTABLE_DIR', 'VITE_DEV_SERVER_URL'])
  delete env[key]
const child = spawn(executable, ['--minimized', '--inspect=127.0.0.1:0', '--enable-logging=stderr'], {
  cwd: path.dirname(executable), env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
})
let output = ''
let inspector
let socket
let sequence = 0
const pending = new Map()
const timeout = setTimeout(() => child.kill(), 30000)
const exited = once(child, 'exit')
const endpoint = new Promise((resolve, reject) => {
  const collect = (data) => {
    output += data
    const match = output.match(/Debugger listening on (ws:\/\/\S+)/)
    if (match)
      resolve(match[1])
  }
  child.stdout.on('data', collect)
  child.stderr.on('data', collect)
  child.once('error', reject)
  child.once('exit', () => reject(new Error(`Executable exited before inspector ready: ${output}`)))
})
try {
  inspector = await endpoint
  socket = new WebSocket(inspector)
  await once(socket, 'open')
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data)
    if (!message.id)
      return
    const request = pending.get(message.id)
    if (!request)
      return
    pending.delete(message.id)
    message.error ? request.reject(new Error(JSON.stringify(message.error))) : request.resolve(message.result)
  })
  const evaluate = expression => new Promise((resolve, reject) => {
    const id = ++sequence
    pending.set(id, { resolve, reject })
    socket.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }))
  })
  await new Promise(resolve => setTimeout(resolve, 1800))
  const result = await evaluate(`(async()=>{
    const electron=process.getBuiltinModule('module').createRequire(process.execPath)('electron');
    const {app,BrowserWindow}=electron;
    await app.whenReady();
    for(let i=0;i<100;i++){
      const win=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('index.html'));
      if(win&&!win.webContents.isLoading()){
        const page=await win.webContents.executeJavaScript('({ready:document.readyState,text:document.body.innerText,preload:!!window.$preload,errors:performance.getEntriesByType("resource").filter(r=>r.name.startsWith("http:")).length})');
        if(page.text.length>10)return {packaged:app.isPackaged,visible:win.isVisible(),url:win.webContents.getURL(),page};
      }
      await new Promise(r=>setTimeout(r,150));
    }
    throw Error('Packaged renderer did not become ready');
  })()`)
  assert.equal(result.exceptionDetails, undefined, JSON.stringify(result.exceptionDetails))
  const state = result.result.value
  assert.equal(state.packaged, true)
  assert.equal(state.visible, false, 'Minimized startup unexpectedly showed a window')
  assert.equal(state.page.preload, true, 'Packaged preload failed')
  assert.ok(state.url.startsWith('file:') && state.url.includes('app.asar'))
  assert.equal(state.page.errors, 0, 'Production page depends on an HTTP dev server')
  assert.doesNotMatch(output, /UnhandledPromiseRejection|Unable to load preload|ERR_MODULE_NOT_FOUND|Failed to load image from path/)
  console.log(JSON.stringify({ passed: true, packaged: true, hiddenMainWindow: true, preload: true, textLength: state.page.text.length, url: state.url }))
}
finally {
  clearTimeout(timeout)
  socket?.close()
  child.kill()
  await exited
}
