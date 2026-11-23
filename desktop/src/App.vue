<template>
  <el-config-provider :locale="locale" :size="size">
    <Layouts />
  </el-config-provider>
</template>

<script setup>
import Layouts from './layouts/index.vue'

const router = useRouter()

const { locale, size } = useWindowStateSync()

window.$preload.ipcRenderer.on('quit-before', async () => {
  ElLoading.service({
    lock: true,
    text: window.t('appClose.quit.loading'),
  })
})

const startApp = useStartApp()

window.$preload.ipcRenderer.on('execute-arguments-change', async (event, params) => {
  startApp.open(params)
})

window.$preload.ipcRenderer.on('navigate-to-route', (event, route) => {
  router.push(route)
})

onMounted(() => {
  showTips()
  startApp.open()
})

const preferenceStore = usePreferenceStore()
const deviceStore = useDeviceStore()
const autoFusionDevices = new Set()
const reconnecting = new Map()
let checking = false
async function checkDesktopConnections() {
  const autoConnect = preferenceStore.data.autoConnect || preferenceStore.data.fusionAutoConnect
  if (checking || (!autoConnect && !preferenceStore.data.fusionAutoOpen))
    return
  checking = true
  try {
    await deviceStore.getList()
    if (autoConnect) {
      for (const device of deviceStore.list) {
        if (!device.wifi || device.status !== 'offline' || (reconnecting.get(device.id) || 0) > Date.now())
          continue
        reconnecting.set(device.id, Infinity)
        window.$preload.adb.connect(device.id).catch(() => {}).finally(() => {
          reconnecting.set(device.id, Date.now() + 30000)
        })
      }
    }
    const available = new Set(deviceStore.list.filter(item => item.status === 'device').map(item => item.id))
    for (const id of autoFusionDevices) {
      if (!available.has(id))
        autoFusionDevices.delete(id)
    }
    if (preferenceStore.data.fusionAutoOpen) {
      for (const device of deviceStore.list) {
        if (device.status !== 'device' || autoFusionDevices.has(device.id))
          continue
        autoFusionDevices.add(device.id)
        try {
          await window.$preload.win.open('pages/desktop', { device: toRaw(device), fusionRole: 'launcher', show: false, instanceId: `fusion:${device.id}` })
        }
        catch (error) {
          autoFusionDevices.delete(device.id)
          console.warn('自动打开桌面模式失败', error)
        }
      }
    }
  }
  catch (error) {
    console.warn('Desktop connection check:', error.message)
  }
  finally {
    checking = false
  }
}
let connectionTimer
onMounted(() => {
  checkDesktopConnections()
  connectionTimer = setInterval(checkDesktopConnections, 5000)
})
onBeforeUnmount(() => clearInterval(connectionTimer))

async function showTips() {
  const { getScrcpy } = window.$preload.configs || {}

  const scrcpyPath = getScrcpy?.({ store: window.$preload.store })

  if (scrcpyPath) {
    return false
  }

  ElMessageBox.alert(
    `<div>
      ${window.t('dependencies.lack.content', {
        name: '<a class="hover:underline text-primary-500" href="https://github.com/Genymobile/scrcpy" target="_blank">scrcpy</a>',
      })}
    <div>`,
    window.t('dependencies.lack.title'),
    {
      dangerouslyUseHTMLString: true,
    },
  )
}
</script>

<style lang="postcss">
</style>
