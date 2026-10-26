import { createWindowManager } from '@yanjiu-scrcpy/electron-setup/main'
import { ipcMain, screen } from 'electron'
import { attachRoundedGlass } from '$electron/helpers/index.js'
import store from '$electron/helpers/store/index.js'

export default {
  name: 'module:main',
  apply(mainApp) {
    let mainWindow
    let resizing
    const stopResize = () => {
      if (resizing)
        clearInterval(resizing.timer)
      resizing = null
    }
    ipcMain.handle('main-window-resize', (event, edge) => {
      if (!mainWindow || mainWindow.isDestroyed() || event.sender !== mainWindow.webContents)
        return false
      stopResize()
      if (!['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'].includes(edge) || mainWindow.isMaximized() || mainWindow.isFullScreen())
        return false
      const bounds = mainWindow.getBounds()
      const start = screen.getCursorScreenPoint()
      const [minWidth, minHeight] = mainWindow.getMinimumSize()
      const tick = () => {
        if (mainWindow.isDestroyed())
          return stopResize()
        const point = screen.getCursorScreenPoint()
        const dx = point.x - start.x
        const dy = point.y - start.y
        const next = { ...bounds }
        if (edge.includes('e'))
          next.width = Math.max(minWidth, bounds.width + dx)
        if (edge.includes('s'))
          next.height = Math.max(minHeight, bounds.height + dy)
        if (edge.includes('w')) {
          next.width = Math.max(minWidth, bounds.width - dx)
          next.x = bounds.x + bounds.width - next.width
        }
        if (edge.includes('n')) {
          next.height = Math.max(minHeight, bounds.height - dy)
          next.y = bounds.y + bounds.height - next.height
        }
        const current = mainWindow.getBounds()
        if (Object.keys(next).some(key => next[key] !== current[key]))
          mainWindow.setBounds(next)
      }
      resizing = { timer: setInterval(tick, 16) }
      return true
    })
    createWindowManager('main', {
      singleton: true,
      mainWindow: true,
      browserWindow: {
        persistenceBounds: true,
        title: 'Yanjiu-scrcpy',
        backgroundColor: '#00000000',
        transparent: true,
        roundedCorners: true,
        hasShadow: false,
        thickFrame: false,
        ...(process.platform === 'win32' ? { backgroundMaterial: 'none' } : {}),
      },
      hooks: {
        async created(win) {
          mainWindow = win
          for (const event of ['blur', 'closed', 'maximize', 'enter-full-screen'])
            win.on(event, stopResize)
          const update = () => {
            if (!win.isDestroyed())
              win.webContents.send('main-window-state', { expanded: win.isMaximized() || win.isFullScreen() })
          }
          for (const event of ['resize', 'maximize', 'unmaximize', 'enter-full-screen', 'leave-full-screen'])
            win.on(event, update)
          win.webContents.on('did-finish-load', update)
          update()
          await attachRoundedGlass(win, store)
        },
      },
    })
  },
}
