export function parseDeviceList(output) {
  return output.split(/\r?\n/).map((line) => {
    const [id, type, ...details] = line.trim().split(/\s+/)
    if (!id || !['device', 'offline', 'unauthorized', 'recovery', 'sideload'].includes(type))
      return null
    return { id, type, ...Object.fromEntries(details.filter(item => item.includes(':')).map(item => [item.split(':')[0], item])) }
  }).filter(Boolean)
}

// Use bounded CLI jobs rather than unbounded adbkit socket reads. A slow phone's
// optional metadata must not prevent its device card from appearing.
export function createDeviceLister(execute) {
  const cache = new Map()
  let pending
  async function read() {
    const { stdout } = await execute(['devices', '-l'], 5000)
    const devices = parseDeviceList(stdout)
    return Promise.all(devices.map(async (device) => {
      const fallback = { ...device, serialNo: device.id, screenWidth: null, screenHeight: null }
      if (device.type !== 'device')
        return fallback
      const previous = cache.get(device.id)
      if (previous && Date.now() - previous.time < 15000)
        return { ...device, ...previous.data }
      try {
        const result = await execute(['-s', device.id, 'shell', 'getprop ro.serialno; getprop ro.boot.serialno; wm size'], 3000)
        const lines = result.stdout.trim().split(/\r?\n/)
        const serialNo = lines.slice(0, 2).find(line => /^[\w.-]+$/.test(line.trim()))?.trim() || device.id
        const size = result.stdout.match(/Override size:\s*(\d+)x(\d+)/) || result.stdout.match(/Physical size:\s*(\d+)x(\d+)/)
        const data = { serialNo, screenWidth: size ? Number(size[1]) : null, screenHeight: size ? Number(size[2]) : null }
        cache.set(device.id, { time: Date.now(), data })
        if (cache.size > 64)
          cache.delete(cache.keys().next().value)
        return { ...device, ...data }
      }
      catch { return previous ? { ...device, ...previous.data } : fallback }
    }))
  }
  return () => {
    pending ||= read().finally(() => {
      pending = null
    })
    return pending
  }
}
