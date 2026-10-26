import store from '$electron/helpers/store/index.js'
import { buildResolve } from '$electron/process/resources.js'
import { app, nativeImage, screen } from 'electron'
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { createWindowManager } from '@yanjiu-scrcpy/electron-setup/main'
import { attachRoundedGlass } from '$electron/helpers/index.js'

function fusionIcon() {
  return nativeImage.createFromPath(buildResolve('fusion.png'))
}
function fusionKey(payload) {
  const id = payload.device?.id || ''
  return `${store.get('androidDesktopIdentities')?.[id] || id}:${payload.fusionApp?.packageName}`
}
function fusionIconPath(icon) {
  const png = icon.resize({ width: 64, height: 64 }).toPNG()
  const header = Buffer.alloc(22)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(1, 4)
  header[6] = header[7] = 64
  header.writeUInt16LE(1, 10)
  header.writeUInt16LE(32, 12)
  header.writeUInt32LE(png.length, 14)
  header.writeUInt32LE(22, 18)
  const file = path.join(app.getPath('userData'), 'fusion-taskbar-outline-bold-v4.ico')
  writeFileSync(file, Buffer.concat([header, png]))
  return file
}
export default {
  name: 'module:desktop:window',
  apply() {
    createWindowManager('pages/desktop', {
      singleton: false,
      browserWindow: ({ payload }) => {
        const fusion = ['launcher', 'app'].includes(payload.fusionRole)
        const launcher = payload.fusionRole === 'launcher'
        const area = screen.getPrimaryDisplay().workArea
        const saved = payload.fusionRole === 'app' ? store.get('fusionAppBounds')?.[fusionKey(payload)] : null
        const width = launcher ? Math.min(620, area.width) : Math.min(saved?.width || 420, area.width)
        const height = launcher ? Math.min(680, area.height) : Math.min(saved?.height || 800, area.height)
        return fusion
          ? {
              ...(launcher ? { icon: fusionIcon(), thickFrame: false } : {}),
              width, height, minWidth: launcher ? 48 : 240, minHeight: launcher ? 48 : 320,
              x: Math.max(area.x, Math.min(saved?.x ?? area.x + Math.round((area.width - width) / 2), area.x + area.width - width)),
              y: Math.max(area.y, Math.min(saved?.y ?? area.y + area.height - height, area.y + area.height - height)),
              frame: !launcher, transparent: launcher, roundedCorners: true, backgroundColor: launcher ? '#00000000' : '#202020',
              ...(launcher && process.platform === 'win32' ? { backgroundMaterial: 'none' } : {}),
              ...(launcher ? {} : { titleBarStyle: 'hidden', titleBarOverlay: { color: '#202020', symbolColor: '#ffffff', height: 32 } }),
              resizable: !launcher, maximizable: !launcher, fullscreenable: !launcher,
              skipTaskbar: false, alwaysOnTop: false, hasShadow: true,
            }
          : { width: 1280, height: 800, minWidth: 800, minHeight: 560, frame: true, backgroundColor: '#18233d' }
      },
      hooks: {
        async created(win, { payload, manager }) {
          if (!payload.fusionRole)
            return
          win.fusionRole = payload.fusionRole
          win.fusionDeviceId = payload.device?.id
          win.fusionBoundsKey = fusionKey(payload)
          win.setBackgroundColor(payload.fusionRole === 'launcher' ? '#00000000' : '#202020')
          try {
            win.setBackgroundMaterial('none')
          }
          catch {}
          win.once('closed', () => clearInterval(win.fusionGestureTimer))
          for (const name of ['enter-full-screen', 'leave-full-screen']) {
            win.on(name, () => {
              win.webContents.send('desktop-host-fullscreen', name === 'enter-full-screen')
            })
          }
          if (payload.fusionRole === 'launcher')
            await attachRoundedGlass(win, store)
          if (payload.fusionRole === 'launcher') {
            win.setTitle('融合模式')
            const icon = fusionIcon()
            win.setAppDetails({ appId: 'YanjiuScrcpy.FusionLauncher.Outline', relaunchIcon: fusionIconPath(icon), relaunchDisplayName: '融合模式', relaunchCommand: `"${process.execPath}"` })
            win.setIcon(icon)
            win.on('restore', () => win.webContents.send('fusion-launcher-open'))
            win.on('minimize', () => win.webContents.send('fusion-launcher-blur'))
            // Dismiss in the main process even when the renderer is busy or its
            // drawer state was already false. Keep the taskbar entry minimized.
            win.on('blur', () => {
              setTimeout(() => {
                if (!win.isDestroyed() && !win.isFocused() && !win.isMinimized())
                  win.minimize()
              }, 80)
            })
            win.once('closed', () => {
              for (const other of manager.getAll()) {
                if (other !== win && other.fusionDeviceId === payload.device?.id && other.fusionRole === 'app')
                  other.close()
              }
            })
          }
          else {
            win.setTitle(payload.fusionApp?.name || 'Android 应用')
            if (payload.fusionApp?.icon?.startsWith('data:image/')) {
              const icon = nativeImage.createFromDataURL(payload.fusionApp.icon)
              if (!icon.isEmpty())
                win.setIcon(icon)
            }
            const remember = () => {
              if (win.isDestroyed() || win.isMinimized() || (win.fusionFullscreen || win.isFullScreen()) || win.isMaximized())
                return
              store.set('fusionAppBounds', { ...store.get('fusionAppBounds'), [win.fusionBoundsKey]: win.getBounds() })
            }
            let rememberTimer
            const scheduleRemember = () => {
              clearTimeout(rememberTimer)
              rememberTimer = setTimeout(remember, 250)
            }
            win.on('moved', scheduleRemember)
            win.on('resized', scheduleRemember)
            win.on('close', () => {
              clearTimeout(rememberTimer)
              remember()
            })
          }
        },
        shown(win, { payload }) {
          if (payload.fusionRole === 'app' && Number.isInteger(payload.fusionTaskId))
            win.webContents.send('fusion-attach-task', payload.fusionTaskId)
          if (!payload.fusionRole)
            win.setFullScreen(store.get('desktopMode.desktopFullscreen') !== false)
        },
      },
    })
  },
}
