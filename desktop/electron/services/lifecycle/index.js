import { app, BrowserWindow } from 'electron'
import { appendFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import remote from '@electron/remote/main'
import { optimizer } from '@electron-toolkit/utils'
import { globalEventEmitter } from '$electron/helpers/emitter/index.js'
import {
  ensureSingleInstance,
  injectExecuteArguments,
  parseExecuteArguments,
  restoreAndFocusWindow,
} from './helpers/index.js'

import { resolveMainWindow } from '@yanjiu-scrcpy/electron-setup/main'

export default {
  name: 'service:lifecycle',
  deps: ['module:main'],
  apply(mainApp) {
    const windowManager = mainApp.getWindowManager('main')

    app.isQuitting = false
    let quittingPromise = null
    const logExit = (reason, details = {}) => {
      try {
        const directory = app.getPath('logs')
        mkdirSync(directory, { recursive: true })
        appendFileSync(path.join(directory, 'lifecycle.log'), `${JSON.stringify({ time: new Date().toISOString(), pid: process.pid, reason, ...details })}\n`)
      }
      catch {}
    }
    logExit('started')
    process.on('uncaughtExceptionMonitor', (error, origin) => logExit('uncaught-exception', { origin, error: error.stack || error.message }))
    process.on('exit', code => logExit('process-exit', { code }))
    app.on('quit', (_event, code) => logExit('app-quit', { code }))

    globalEventEmitter.on('app:quit', () => {
      requestQuit('tray-or-explicit-quit')
    })

    ensureSingleInstance({
      onCreateWindow: openMainWindow,
      onShowWindow: showMainWindow,
    })

    async function openMainWindow() {
      windowManager.open({ show: false })

      const mainWindow = await resolveMainWindow(mainApp)

      if (!mainApp?.hasService?.('remote:initialized')) {
        mainApp?.provide?.('remote:initialized', true)
        remote.initialize()
        remote.enable(mainWindow.webContents)
      }

      const args = runExecuteArguments(process.argv, mainWindow)
      if (args?.minimized) {
        globalEventEmitter.emit('tray:create')
        return false
      }

      mainWindow.show?.()
    }

    async function showMainWindow(commandLine) {
      const mainWindow = await resolveMainWindow(mainApp)

      const args = runExecuteArguments(commandLine, mainWindow)
      if (!args?.['device-id']) {
        restoreAndFocusWindow(mainWindow)
      }
    }

    app.on('browser-window-created', (_, window) => {
      optimizer.watchWindowShortcuts(window)
    })

    app.on('activate', async () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        return
      }

      const mainWindow = await resolveMainWindow(mainApp)
      restoreAndFocusWindow(mainWindow)
    })

    app.on('window-all-closed', () => {
      requestQuit('window-all-closed')
    })

    app.on('before-quit', (event) => {
      if (app.isQuitting) {
        return
      }

      // Do NOT call event.preventDefault() — let the quit proceed normally.
      requestQuit('before-quit')
    })

    function requestQuit(reason) {
      logExit(reason, { windows: BrowserWindow.getAllWindows().map(win => ({ id: win.id, title: win.getTitle(), visible: win.isVisible() })) })
      if (app.isQuitting) {
        return
      }

      app.isQuitting = true

      if (quittingPromise) {
        return
      }

      quittingPromise = (async () => {
        try {
          await mainApp.stop()
        }
        catch (error) {
          console.error('[lifecycle] App cleanup failed:', error?.message || error)
        }
        finally {
          app.quit()
        }
      })()
    }

    function runExecuteArguments(commandLine = '', mainWindow) {
      try {
        const args = parseExecuteArguments(commandLine)

        if (!args) {
          console.warn('[lifecycle] Failed to parse execute arguments')
          return null
        }

        injectExecuteArguments(args)
        if (mainWindow?.webContents && !mainWindow.isDestroyed?.()) {
          mainWindow.webContents.send('execute-arguments-change', {
            deviceId: args['device-id'],
            appName: args['app-name'],
            packageName: args['package-name'],
            userId: args['user-id'],
            activity: args.activity,
            landscape: args.landscape,
          })
        }

        return args
      }
      catch (error) {
        console.error('[lifecycle] Failed to run execute arguments:', error?.message || error)
        return null
      }
    }
  },
}
