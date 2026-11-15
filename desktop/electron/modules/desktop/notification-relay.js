import { createConnection } from 'node:net'

export const notificationPackage = 'dev.yanjiu.scrcpy.notifications'

// Listing an absent package succeeds with empty output; `pm path` exits 1.
export async function notificationCompanionInstalled(adb, deviceId) {
  const output = await adb(deviceId, ['shell', 'pm', 'list', 'packages', notificationPackage], { timeout: 5000 })
  return output.split(/\r?\n/).some(line => line.trim() === `package:${notificationPackage}`)
}

// One connection per ADB transport, shared by all windows. No polling while live.
export function createNotificationRelay({ adb, publish, sourceChanged }) {
  const devices = new Map()
  function stateFor(deviceId) {
    if (!devices.has(deviceId))
      devices.set(deviceId, { owners: new Set(), ready: false, notices: [], nextAttempt: 0 })
    return devices.get(deviceId)
  }
  function notify(state, deviceId, posted) {
    for (const owner of state.owners) {
      if (!owner.isDestroyed()) {
        sourceChanged(owner, state.ready)
        if (state.ready)
          publish(owner, state.notices, deviceId, posted)
      }
    }
  }
  function stop(state, deviceId) {
    state.ready = false
    state.notices = []
    state.socket?.destroy()
    state.socket = null
    if (state.port) {
      const port = state.port
      state.port = null
      adb(deviceId, ['forward', '--remove', `tcp:${port}`], { timeout: 3000 }).catch(() => {})
    }
    notify(state, deviceId)
  }
  async function connect(state, deviceId) {
    state.nextAttempt = Date.now() + 30000
    try {
      const installed = await notificationCompanionInstalled(adb, deviceId)
      if (!installed || !state.owners.size)
        return
      // Wake an already-installed/authorized helper without opening an Activity.
      // Older helpers may not have this receiver; keep the polling fallback.
      await adb(deviceId, ['shell', 'am', 'broadcast', '--receiver-foreground', '-f', '0x01000000', '-a', `${notificationPackage}.WAKE`, '--include-stopped-packages', '-n', `${notificationPackage}/.WakeReceiver`], { timeout: 3000 }).catch(() => {})
      const port = Number((await adb(deviceId, ['forward', 'tcp:0', 'localabstract:yanjiu-notifications-v1'], { timeout: 3000 })).trim())
      if (!Number.isInteger(port) || port < 1 || port > 65535)
        throw new Error('Invalid notification port')
      state.port = port
      if (!state.owners.size) {
        stop(state, deviceId)
        return
      }
      await new Promise((resolve) => {
        const socket = state.socket = createConnection({ host: '127.0.0.1', port })
        let buffer = ''
        let settled = false
        let timer
        const finish = () => {
          if (!settled) {
            settled = true
            clearTimeout(timer)
            resolve()
          }
        }
        timer = setTimeout(() => {
          socket.destroy()
          finish()
        }, 2500)
        socket.setEncoding('utf8')
        socket.on('data', (data) => {
          buffer += data
          if (buffer.length > 4 * 1024 * 1024) {
            socket.destroy()
            return
          }
          let index
          while ((index = buffer.indexOf('\n')) >= 0) {
            const line = buffer.slice(0, index)
            buffer = buffer.slice(index + 1)
            try {
              const message = JSON.parse(line)
              if (message.type === 'posted' && typeof message.notice?.key === 'string' && typeof message.notice.packageName === 'string') {
                state.notices = [message.notice, ...state.notices.filter(n => n.key !== message.notice.key)].slice(0, 80)
              }
              else if (message.type === 'snapshot' && Array.isArray(message.notices)) {
                state.notices = message.notices.slice(0, 80).filter(n => typeof n.key === 'string' && typeof n.packageName === 'string')
              }
              else {
                socket.destroy()
                return
              }
              state.ready = true
              state.nextAttempt = 0
              notify(state, deviceId, message.type === 'posted' ? message.notice : undefined)
              finish()
            }
            catch {
              socket.destroy()
              return
            }
          }
        })
        socket.on('error', () => {})
        socket.once('close', () => {
          state.nextAttempt = Date.now() + 10000
          stop(state, deviceId)
          finish()
        })
      })
    }
    catch { stop(state, deviceId) }
  }
  return {
    async read(owner, deviceId) {
      const state = stateFor(deviceId)
      if (!state.owners.has(owner)) {
        state.owners.add(owner)
        owner.once('closed', () => {
          state.owners.delete(owner)
          if (!state.owners.size) {
            stop(state, deviceId)
            if (!state.pending)
              devices.delete(deviceId)
          }
        })
      }
      if (!state.ready && !state.pending && Date.now() >= state.nextAttempt) {
        state.pending = connect(state, deviceId).finally(() => {
          state.pending = null
          if (!state.owners.size) {
            stop(state, deviceId)
            devices.delete(deviceId)
          }
        })
      }
      if (state.pending)
        await state.pending
      sourceChanged(owner, state.ready)
      return state.ready ? state.notices : null
    },
    retry(deviceId) {
      const state = devices.get(deviceId)
      if (state) {
        stop(state, deviceId)
        state.nextAttempt = 0
      }
    },
    close() {
      for (const [deviceId, state] of devices) {
        state.owners.clear()
        stop(state, deviceId)
      }
      devices.clear()
    },
  }
}
