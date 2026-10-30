import store from '$electron/helpers/store/index.js'
import { buildResolve } from '$electron/process/resources.js'
import { app, BrowserWindow, ipcMain, Menu, nativeImage, screen, Tray } from 'electron'
import { globalEventEmitter } from '$electron/helpers/emitter/index.js'
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { trayPath } from '$electron/configs/index.js'
import { createHash } from 'node:crypto'
import { createWindowManager } from '@yanjiu-scrcpy/electron-setup/main'
import { attachRoundedGlass } from '$electron/helpers/index.js'

function fusionIcon() {
  const image = nativeImage.createFromPath(buildResolve('fusion-monitor-tray.png'))
  return image.isEmpty() ? nativeImage.createFromPath(trayPath) : image
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
  const file = path.join(app.getPath('userData'), 'fusion-monitor-v1.ico')
  writeFileSync(file, Buffer.concat([header, png]))
  return file
}

// Native video children cannot show transparent HTML through a cut-out. Keep
// the fullscreen control in its own small, truly transparent owned window.
const fullscreenControls = new Map()
function fullscreenControlPage() {
  return `<!doctype html><meta charset="utf-8"><style>
  html,body{margin:0;width:100%;height:100%;background:transparent!important;overflow:hidden}
  #zone{width:80px;height:80px;display:flex;align-items:center;justify-content:flex-end}
  button{width:44px;height:44px;flex:none;border:1px solid #ffffff55;border-radius:50%;background:#555b;color:white;box-shadow:none;display:grid;place-items:center;transform:translateX(22px);transition:transform .2s;touch-action:none;padding:0}
  body.left #zone{justify-content:flex-start}body.left button{transform:translateX(-22px)}
  #zone:hover button,button.dragging{transform:translateX(0)}svg{width:20px;height:20px;pointer-events:none}
  </style><div id="zone"><button title="退出全屏（拖动调整位置）"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M9 3v6H3m12-6v6h6M9 21v-6H3m12 6v-6h6"/></svg></button></div>
  <script>const {ipcRenderer}=require('electron');const button=document.querySelector('button');let press;
  button.onpointerdown=e=>{if(e.button!==0)return;press={x:e.screenX,y:e.screenY,moved:false};button.setPointerCapture(e.pointerId);button.classList.add('dragging')};
  button.onpointermove=e=>{if(!press)return;if(Math.hypot(e.screenX-press.x,e.screenY-press.y)>5)press.moved=true;if(press.moved)ipcRenderer.send('desktop-fullscreen-control',{action:'move',x:e.screenX,y:e.screenY})};
  button.onpointerup=e=>{if(!press)return;ipcRenderer.send('desktop-fullscreen-control',{action:press.moved?'save':'exit'});press=null;button.classList.remove('dragging');if(button.hasPointerCapture(e.pointerId))button.releasePointerCapture(e.pointerId)};
  button.onpointercancel=()=>{press=null;button.classList.remove('dragging')};
  button.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();ipcRenderer.send('desktop-fullscreen-control',{action:'exit'})}};
  ipcRenderer.on('fullscreen-position',(_,left)=>document.body.classList.toggle('left',left));</script>`
}
function attachFullscreenControl(host) {
  let control
  let loading
  const saved = store.get('fullscreenControlPosition') || {}
  let position = { side: saved.side === 'left' ? 'left' : 'right', y: Number.isFinite(saved.y) ? Math.max(0, Math.min(1, saved.y)) : 0.45 }
  const place = () => {
    if (!control || control.isDestroyed() || host.isDestroyed())
      return
    const area = screen.getDisplayMatching(host.getBounds()).bounds
    control.setPosition(position.side === 'left' ? area.x : area.x + area.width - 80, Math.round(area.y + position.y * Math.max(0, area.height - 80)))
    control.webContents.send('fullscreen-position', position.side === 'left')
  }
  const update = async () => {
    if (host.isDestroyed())
      return
    if (!host.isFullScreen() || !host.isVisible() || host.isMinimized() || app.bossHidden) {
      control?.hide()
      return
    }
    if (!control) {
      control = new BrowserWindow({ width: 80, height: 80, frame: false, transparent: true, backgroundColor: '#00000000', hasShadow: false, skipTaskbar: true, focusable: false, resizable: false, show: false, webPreferences: { nodeIntegration: true, contextIsolation: false, sandbox: false } })
      const controlId = control.webContents.id
      control.once('closed', () => fullscreenControls.delete(controlId))
      control.keepTaskbarHidden = true
      control.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
      control.webContents.on('will-navigate', event => event.preventDefault())
      fullscreenControls.set(control.webContents.id, {
        host,
        move(x, y) {
          const area = screen.getDisplayMatching(host.getBounds()).bounds
          position = { side: x < area.x + area.width / 2 ? 'left' : 'right', y: Math.max(0, Math.min(1, (y - area.y - 40) / Math.max(1, area.height - 80))) }
          place()
        },
        save() { store.set('fullscreenControlPosition', position) },
      })
      loading = control.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(fullscreenControlPage())}`)
    }
    await loading
    if (host.isDestroyed() || control.isDestroyed() || !host.isFullScreen() || !host.isVisible() || host.isMinimized() || app.bossHidden)
      return
    place()
    control.setAlwaysOnTop(true, 'screen-saver')
    control.showInactive()
    control.moveTop()
  }
  const refresh = () => update().catch(error => console.warn('Fullscreen control:', error.message))
  for (const event of ['enter-full-screen', 'leave-full-screen', 'show', 'hide', 'minimize', 'restore', 'moved', 'resized'])
    host.on(event, refresh)
  // Fullscreen transitions may reorder/hide owned windows on Windows. Keep
  // this independent tool window visible after the native transition settles.
  const visibilityTimer = setInterval(refresh, 500)
  globalEventEmitter.on('boss:visibility', refresh)
  host.once('closed', () => {
    clearInterval(visibilityTimer)
    globalEventEmitter.removeListener('boss:visibility', refresh)
    if (control && !control.isDestroyed()) {
      fullscreenControls.delete(control.webContents.id)
      control.destroy()
    }
  })
}

const floatingTargets = new Set()
// Local, generated UI only: notification text is assigned through textContent.
function floatingPage(icon, name) {
  const data = JSON.stringify({ icon, name }).replaceAll('<', '\\u003c')
  return `<!doctype html><meta charset="utf-8"><style>
  *{box-sizing:border-box}body{margin:0;background:transparent;font:14px system-ui;color:white;overflow:hidden}
  #notice{position:absolute;right:86px;bottom:8px;width:250px;padding:14px;border:1px solid #7776;border-radius:20px;background:#292929ed;display:none;cursor:pointer;animation:in .22s ease-out}#text{opacity:.8;margin-top:5px;overflow:hidden;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical}
  button{position:absolute;right:8px;bottom:8px;width:64px;height:64px;padding:0;border-radius:18px;border:0;background:transparent;box-shadow:none;color:white;cursor:pointer;transition:transform .15s}button:active{transform:scale(.9)}img{width:64px;height:64px;object-fit:contain;pointer-events:none}#badge{position:absolute;right:-3px;top:-3px;background:#ddd;color:#222;border-radius:12px;padding:1px 5px;font-size:11px;display:none}body.light{color:#181818}body.light #notice{background:#efefeff2;border-color:#fff}body.light button{background:transparent;border:0;color:#181818}@keyframes in{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:none}}</style>
  <style>button{right:0;bottom:8px;transform:translateX(32px);transition:transform .24s cubic-bezier(.2,.8,.2,1)}#hover-zone{position:absolute;right:0;bottom:0;width:80px;height:80px}#hover-zone:hover button,button:focus,button.dragging{transform:translateX(0)}button:active{transform:translateX(0) scale(.94);transform-origin:right center}</style>
  <div id="notice"><b id="title"></b><div id="text"></div></div><div id="hover-zone"><button id="button"><img id="icon"><span id="badge"></span></button></div>
  <script>const {ipcRenderer}=require('electron');const data=${data};const button=document.getElementById('button');const icon=document.getElementById('icon');icon.src=data.icon;icon.alt=data.name;button.title=data.name;let press,drag=false,timer,count=0;
  button.onpointerdown=e=>{if(e.button!==0)return;press={x:e.screenX,y:e.screenY};drag=false;button.classList.add('dragging');button.setPointerCapture(e.pointerId)};
  button.onpointermove=e=>{if(!press)return;const dx=e.screenX-press.x,dy=e.screenY-press.y;if(Math.abs(dx)+Math.abs(dy)>4)drag=true;if(drag){ipcRenderer.send('fusion-float-action',{action:'move',dx,dy});press={x:e.screenX,y:e.screenY}}};
  button.onpointerup=()=>{if(press&&!drag)ipcRenderer.send('fusion-float-action',{action:'restore'});press=null;button.classList.remove('dragging');button.blur()};button.onpointercancel=()=>{press=null;button.classList.remove('dragging')};
  document.getElementById('notice').onclick=()=>ipcRenderer.send('fusion-float-action',{action:'restore'});
  ipcRenderer.on('float-state',(_,state)=>{document.body.classList.toggle('light',state.light);button.style.display=state.minimized?'block':'none';if(state.hideNotice)document.getElementById('notice').style.display='none';if(state.notice){count++;const badge=document.getElementById('badge');badge.textContent=count>99?'99+':count;badge.style.display='block';document.getElementById('title').textContent=state.notice.title||data.name;document.getElementById('text').textContent=state.notice.text||'';document.getElementById('notice').style.display='block';clearTimeout(timer);timer=setTimeout(()=>{document.getElementById('notice').style.display='none';ipcRenderer.send('fusion-float-action',{action:'expired'})},5000)}else if(state.clear){count=0;document.getElementById('badge').style.display='none';document.getElementById('notice').style.display='none'}});
  </script>`
}
export function registerFloatingTarget({ deviceId, packageName, name, icon, restore, isMinimized, close, nativeFocus = false }) {
  const target = { deviceId, packageName, restore, isMinimized, close, nativeFocus, minimized: false, bubble: null, noticeUntil: 0 }
  floatingTargets.add(target)
  const area = screen.getPrimaryDisplay().workArea
  const rank = floatingTargets.size - 1
  target.position = { x: area.x + area.width - 80, y: area.y + Math.max(0, Math.min(area.height - 80, 100 + rank * 84)) }
  target.update = async (notice, clear = false) => {
    if (target.closed || app.bossHidden)
      return
    target.minimized = await isMinimized()
    if (target.closed || app.bossHidden)
      return
    if (notice)
      target.noticeUntil = Date.now() + 5200
    if (!target.minimized && Date.now() >= target.noticeUntil) {
      target.bubble?.hide()
      return
    }
    if (!target.bubble) {
      const bubble = target.bubble = new BrowserWindow({ ...target.position, width: 80, height: 80, frame: false, transparent: true, backgroundColor: '#00000000', hasShadow: false, skipTaskbar: true, resizable: false, alwaysOnTop: true, show: false, focusable: false, webPreferences: { nodeIntegration: true, contextIsolation: false, sandbox: false } })
      bubble.keepTaskbarHidden = true
      bubble.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
      bubble.webContents.on('will-navigate', event => event.preventDefault())
      target.loading = bubble.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(floatingPage(icon || nativeImage.createFromPath(trayPath).toDataURL(), name))}`)
      await target.loading
      if (target.closed || app.bossHidden)
        return
    }
    await target.loading
    if (target.closed || app.bossHidden)
      return
    const hasNotice = Date.now() < target.noticeUntil
    const width = hasNotice ? 340 : 80
    const height = hasNotice ? 160 : 80
    const bounds = target.bubble.getBounds()
    const nextBounds = { x: target.position.x - (width - 80), y: target.position.y - (height - 80), width, height }
    if (Object.keys(nextBounds).some(key => bounds[key] !== nextBounds[key]))
      target.bubble.setBounds(nextBounds)
    const shapeKey = `${width}:${height}:${target.minimized}:${hasNotice}`
    if (['win32', 'linux'].includes(process.platform) && shapeKey !== target.shapeKey) {
      target.shapeKey = shapeKey
      const shape = []
      const rounded = (x, y, width, height, radius) => {
        for (let row = 0; row < height; row++) {
          const distance = row < radius ? radius - row - 0.5 : row >= height - radius ? row - (height - radius) + 0.5 : 0
          const inset = distance ? Math.ceil(radius - Math.sqrt(radius * radius - distance * distance)) : 0
          shape.push({ x: x + inset, y: y + row, width: width - inset * 2, height: 1 })
        }
      }
      if (target.minimized)
        shape.push({ x: width - 80, y: height - 80, width: 80, height: 80 })
      if (hasNotice)
        rounded(4, 8, 250, 144, 20)
      target.bubble.setShape(shape)
    }
    target.bubble.webContents.send('float-state', { minimized: target.minimized, notice, clear, hideNotice: Date.now() >= target.noticeUntil, light: store.get('common.theme') === 'light' || (store.get('common.theme') === 'system' && !store.get('common.isDark')) })
    // Reassert the topmost order without taking keyboard focus. A native mirror
    // or another topmost application can otherwise cover an existing bubble.
    target.bubble.setAlwaysOnTop(true, 'screen-saver')
    if (!target.bubble.isVisible())
      target.bubble.showInactive()
    target.bubble.moveTop()
  }
  target.dispose = () => {
    target.closed = true
    floatingTargets.delete(target)
    target.bubble?.destroy()
  }
  return target
}
async function animateWindow(win, opening, target) {
  if (win.isDestroyed() || app.bossHidden)
    return
  const generation = win.floatAnimation = (win.floatAnimation || 0) + 1
  const bounds = win.getBounds()
  const destination = target?.position || bounds
  const end = { x: Math.round(destination.x + 40 - bounds.width / 2), y: Math.round(destination.y + 40 - bounds.height / 2) }
  win.floatingTransition = true
  const start = Date.now()
  if (opening) {
    win.setOpacity(0)
    win.setPosition(end.x, end.y)
    if (win.isMinimized())
      win.restore()
    win.show()
    win.focus()
  }
  await new Promise((resolve) => {
    const tick = () => {
      if (win.isDestroyed() || generation !== win.floatAnimation || app.bossHidden) {
        if (!win.isDestroyed() && generation === win.floatAnimation) {
          win.hide()
          win.setBounds(bounds)
          win.setOpacity(1)
          win.floatingTransition = false
        }
        resolve()
        return
      }
      const t = Math.min(1, (Date.now() - start) / 240)
      const eased = 1 - (1 - t) ** 3
      const distance = opening ? 1 - eased : eased
      win.setPosition(Math.round(bounds.x + (end.x - bounds.x) * distance), Math.round(bounds.y + (end.y - bounds.y) * distance))
      win.setOpacity(opening ? eased : 1 - eased)
      if (t < 1) {
        setTimeout(tick, 16)
      }
      else {
        if (!opening)
          win.hide()
        win.setBounds(bounds)
        win.setOpacity(1)
        win.floatingTransition = false
        resolve()
      }
    }
    tick()
  })
}
export default {
  name: 'module:desktop:window',
  apply() {
    ipcMain.on('desktop-fullscreen-control', (event, request = {}) => {
      const target = fullscreenControls.get(event.sender.id)
      if (!target || target.host.isDestroyed() || !target.host.isFullScreen() || app.bossHidden)
        return
      if (request.action === 'exit')
        target.host.webContents.send('desktop-fullscreen-exit')
      else if (request.action === 'move' && Number.isFinite(request.x) && Number.isFinite(request.y))
        target.move(request.x, request.y)
      else if (request.action === 'save')
        target.save()
    })
    ipcMain.on('fusion-float-action', (event, request = {}) => {
      const target = [...floatingTargets].find(item => item.bubble?.webContents === event.sender)
      if (!target || app.bossHidden)
        return
      if (request.action === 'restore') {
        target.noticeUntil = 0
        if (target.restoring)
          return
        target.restoring = true
        // Only a user click may give this tool window foreground rights for the
        // native mirror handoff. Notifications/hover never activate the bubble.
        if (target.nativeFocus && target.bubble && !target.bubble.isDestroyed()) {
          target.bubble.setFocusable(true)
          target.bubble.focus()
        }
        Promise.resolve().then(() => target.restore()).then(() => target.update(null, true)).catch(() => {}).finally(() => {
          target.restoring = false
          if (target.nativeFocus && target.bubble && !target.bubble.isDestroyed())
            target.bubble.setFocusable(false)
        })
      }
      else if (request.action === 'expired') {
        target.noticeUntil = 0
        target.update().catch(() => {})
      }
      else if (request.action === 'move' && Number.isFinite(request.dx) && Number.isFinite(request.dy)) {
        const bounds = target.bubble.getBounds()
        const area = screen.getDisplayMatching(bounds).workArea
        target.position = { x: area.x + area.width - 80, y: Math.round(Math.max(area.y, Math.min(target.position.y + request.dy, area.y + area.height - 80))) }
        target.bubble.setPosition(target.position.x - (bounds.width - 80), target.position.y - (bounds.height - 80))
      }
    })
    globalEventEmitter.on('desktop:notification-snapshot', ({ deviceId, notices }) => {
      for (const target of floatingTargets) {
        if (target.deviceId !== deviceId)
          continue
        const previous = target.notices
        target.notices = new Map(notices.map(item => [item.key, `${item.title}\n${item.text}`]))
        if (!previous)
          continue
        const changed = notices.filter(item => (!target.packageName || item.packageName === target.packageName) && previous.get(item.key) !== target.notices.get(item.key))
        if (changed.length)
          target.update(changed.at(-1)).catch(() => {})
      }
    })
    globalEventEmitter.on('boss:visibility', (hidden) => {
      if (!hidden) {
        for (const target of floatingTargets) target.update().catch(() => {})
      }
    })
    for (const key of ['common.theme', 'common.isDark']) {
      store.onDidChange(key, () => {
        for (const target of floatingTargets) target.update().catch(() => {})
      })
    }
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
              ...(launcher ? {} : { titleBarStyle: 'hidden', titleBarOverlay: false }),
              resizable: !launcher, maximizable: !launcher, fullscreenable: !launcher,
              skipTaskbar: launcher, alwaysOnTop: false, hasShadow: true,
            }
          : { width: 1280, height: 800, minWidth: 800, minHeight: 560, frame: true, backgroundColor: '#18233d' }
      },
      hooks: {
        async created(win, { payload, manager }) {
          if (!payload.fusionRole)
            return
          if (payload.fusionRole === 'app')
            attachFullscreenControl(win)
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
            win.keepTaskbarHidden = true
            win.setSkipTaskbar(true)
            let tray
            const createTray = () => {
              if (tray || win.isDestroyed() || app.bossHidden)
                return
              tray = new Tray(fusionIcon(), (() => {
                const hash = createHash('sha256').update(`YanjiuScrcpy.DesktopTray:${store.get('androidDesktopIdentities')?.[payload.device?.id] || payload.device?.id || 'default'}`).digest('hex')
                return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`
              })())
              tray.setToolTip('Yanjiu-scrcpy · 桌面模式')
              tray.on('click', () => {
                const bounds = tray.getBounds()
                win.fusionTrayBounds = bounds
                if (win.isVisible() && !win.isMinimized()) {
                  win.hide()
                }
                else {
                  win.webContents.send('fusion-launcher-open')
                }
              })
              tray.setContextMenu(Menu.buildFromTemplate([{ label: '打开应用栏', click: () => {
                win.webContents.send('fusion-launcher-open')
              } }, { label: '退出桌面模式', click: () => win.close() }]))
            }
            const boss = (hidden) => {
              if (hidden) {
                tray?.destroy()
                tray = null
              }
              else {
                createTray()
              }
            }
            globalEventEmitter.on('boss:visibility', boss)
            createTray()
            win.once('closed', () => {
              tray?.destroy()
              globalEventEmitter.off('boss:visibility', boss)
            })
            win.setTitle('桌面模式')
            const icon = fusionIcon()
            if (process.platform === 'win32')
              win.setAppDetails({ appId: 'YanjiuScrcpy.FusionLauncher.Outline', relaunchIcon: fusionIconPath(icon), relaunchDisplayName: '桌面模式', relaunchCommand: `"${process.execPath}"` })
            win.setIcon(icon)
            win.on('hide', () => win.webContents.send('fusion-launcher-blur'))
            win.on('minimize', () => win.webContents.send('fusion-launcher-blur'))
            // Dismiss in the main process even when the renderer is busy or its
            // drawer state was already false. The entry remains in the system tray.
            win.on('blur', () => {
              setTimeout(() => {
                if (!win.isDestroyed() && !win.isFocused() && !win.isMinimized())
                  win.hide()
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
            win.keepTaskbarHidden = false
            win.setSkipTaskbar(false)
            const floating = registerFloatingTarget({ deviceId: payload.device?.id, packageName: payload.fusionApp?.packageName, name: payload.fusionApp?.name || 'Android 应用', icon: payload.fusionApp?.icon, isMinimized: () => !win.isVisible() || win.isMinimized(), restore: async () => {
              win.fusionMinimized = false
              await animateWindow(win, true, floating)
            } })
            win.fusionMinimize = async () => {
              win.fusionMinimized = true
              await animateWindow(win, false, floating)
              await floating.update()
            }
            win.on('minimize', () => {
              if (!app.bossHidden) {
                win.fusionMinimized = true
                win.hide()
                floating.update().catch(() => {})
              }
            })
            win.on('show', () => {
              floating.noticeUntil = 0
              floating.update(null, true).catch(() => {})
            })
            win.once('closed', () => floating.dispose())
            if (process.platform === 'win32') {
              const identity = createHash('sha256').update(fusionKey(payload)).digest('hex').slice(0, 24)
              win.setAppDetails({ appId: `YanjiuScrcpy.AndroidApp.${identity}` })
            }
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
              if (win.floatingTransition)
                return
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
          if (payload.fusionRole === 'launcher')
            win.webContents.send('fusion-launcher-open')
          if (payload.fusionRole === 'app' && Number.isInteger(payload.fusionTaskId))
            win.webContents.send('fusion-attach-task', payload.fusionTaskId)
          if (!payload.fusionRole)
            win.setFullScreen(store.get('desktopMode.desktopFullscreen') !== false)
        },
      },
    })
  },
}
