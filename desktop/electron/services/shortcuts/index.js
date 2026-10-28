import store from '$electron/helpers/store/index.js'
import { app, BrowserWindow, globalShortcut, ipcMain } from 'electron'
import { globalEventEmitter } from '$electron/helpers/emitter/index.js'

const registeredShortcuts = new Map()
let isRecordingMode = false
let bossAccelerator = ''
let hiddenWindows = null
function toggleBossWindows() {
  if (hiddenWindows) {
    const restore = hiddenWindows
    hiddenWindows = null
    app.bossHidden = false
    for (const state of restore) {
      const { win } = state
      if (win.isDestroyed())
        continue
      win.setSkipTaskbar(Boolean(win.keepTaskbarHidden))
      if (win.fusionRole === 'app' && (state.minimized || state.fusionMinimized || !state.visible)) {
        win.hide()
        continue
      }
      if (state.minimized) {
        win.showInactive()
        win.minimize()
      }
      else if (state.visible) {
        win.show()
      }
    }
    globalEventEmitter.emit('boss:visibility', false)
    return
  }
  app.bossHidden = true
  hiddenWindows = BrowserWindow.getAllWindows().map(win => ({ win, visible: win.isVisible(), minimized: win.isMinimized(), fusionMinimized: win.fusionMinimized }))
  for (const { win } of hiddenWindows) {
    win.setSkipTaskbar(true)
    win.hide()
  }
  globalEventEmitter.emit('boss:visibility', true)
}
function setBossKey(accelerator) {
  if (typeof accelerator !== 'string' || accelerator.length > 100)
    return { success: false, error: '无效的组合键' }
  if (accelerator === bossAccelerator)
    return { success: true }
  if (accelerator) {
    try {
      if (!globalShortcut.register(accelerator, toggleBossWindows))
        return { success: false, error: '组合键已被占用，请换一个' }
    }
    catch {
      return { success: false, error: '不支持这个组合键' }
    }
  }
  if (bossAccelerator)
    globalShortcut.unregister(bossAccelerator)
  bossAccelerator = accelerator
  if (!accelerator && hiddenWindows)
    toggleBossWindows()
  store.set('common.bossKey', accelerator)
  return { success: true }
}

function sendShortcutTriggered(id) {
  if (isRecordingMode) {
    return
  }

  BrowserWindow.getAllWindows().forEach((window) => {
    if (window.isDestroyed() || window.webContents.isDestroyed()) {
      return
    }

    window.webContents.send('shortcut-triggered', id)
  })
}

function unregisterById(id) {
  const accelerator = registeredShortcuts.get(id)

  if (!accelerator) {
    return { id, unregistered: false }
  }

  globalShortcut.unregister(accelerator)
  registeredShortcuts.delete(id)
  return { id, accelerator, unregistered: true }
}

function unregisterAll() {
  const ids = Array.from(registeredShortcuts.keys())
  ids.forEach(id => unregisterById(id))
  return { unregistered: ids.length }
}

function registerShortcut(payload = {}) {
  const { id, accelerator } = payload

  if (!id || !accelerator) {
    return {
      success: false,
      error: 'Shortcut id and accelerator are required',
    }
  }

  unregisterById(id)

  const registered = globalShortcut.register(accelerator, () => {
    sendShortcutTriggered(id)
  })

  if (!registered) {
    return {
      success: false,
      error: `Failed to register shortcut: ${accelerator}`,
    }
  }

  registeredShortcuts.set(id, accelerator)
  return { success: true, data: { id, accelerator } }
}

export default {
  name: 'service:shortcuts',
  apply() {
    const guardWindow = (_event, win) => {
      win.on('show', () => {
        if (hiddenWindows) {
          if (!hiddenWindows.some(state => state.win === win))
            hiddenWindows.push({ win, visible: true, minimized: win.isMinimized() })
          win.setSkipTaskbar(true)
          win.hide()
        }
      })
    }
    for (const win of BrowserWindow.getAllWindows()) guardWindow(null, win)
    app.on('browser-window-created', guardWindow)
    setBossKey(store.get('common.bossKey') || '')
    ipcMain.handle('boss-key-set', (_, accelerator) => setBossKey(accelerator))
    ipcMain.handle('shortcut-register', (_, payload) => {
      return registerShortcut(payload)
    })

    ipcMain.handle('shortcut-unregister', (_, id) => {
      return unregisterById(id)
    })

    ipcMain.handle('shortcut-unregister-all', () => {
      return unregisterAll()
    })

    ipcMain.handle('shortcut-is-registered', (_, accelerator) => {
      return globalShortcut.isRegistered(accelerator)
    })

    ipcMain.handle('shortcut-set-recording-mode', (_, enabled) => {
      isRecordingMode = Boolean(enabled)

      if (isRecordingMode) {
        for (const accelerator of registeredShortcuts.values()) {
          globalShortcut.unregister(accelerator)
        }

        return { success: true }
      }

      for (const [id, accelerator] of registeredShortcuts) {
        const isRegistered = globalShortcut.isRegistered(accelerator)

        if (!isRegistered) {
          globalShortcut.register(accelerator, () => {
            sendShortcutTriggered(id)
          })
        }
      }

      return { success: true }
    })

    return () => {
      if (bossAccelerator)
        globalShortcut.unregister(bossAccelerator)
      app.removeListener('browser-window-created', guardWindow)
      ipcMain.removeHandler('boss-key-set')
      unregisterAll()
      ipcMain.removeHandler('shortcut-register')
      ipcMain.removeHandler('shortcut-unregister')
      ipcMain.removeHandler('shortcut-unregister-all')
      ipcMain.removeHandler('shortcut-is-registered')
      ipcMain.removeHandler('shortcut-set-recording-mode')
    }
  },
}
