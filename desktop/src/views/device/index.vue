<template>
  <div class="devices-page h-full flex flex-col">
    <div v-loading="loading && !deviceList.length" :element-loading-text="$t('common.loading')" class="device-cards flex-1 min-h-0 overflow-auto">
      <div v-if="loadError && !deviceList.length" class="device-load-error">
        <el-alert :title="loadError" type="warning" :closable="false" />
        <el-button class="mt-3" @click="handleRefresh">
          重新加载
        </el-button>
      </div>
      <AppEmpty v-else-if="!loading && !deviceList.length" :sub-title="$t('device.list.empty')" />
      <article v-for="row in deviceList" :key="row.id" class="device-card">
        <div class="device-card-identity">
          <div class="device-card-name">
            <Remark :device="row" />
          </div>
          <div class="device-card-serial">
            <DevicePopover :key="row.status" :device="row" />
            <span :title="row.id">{{ row.id }}</span>
            <i v-if="row.wifi" class="i-bi-wifi flex-none" title="Wi-Fi"></i>
          </div>
        </div>
        <el-tag effect="plain" class="device-card-status" :type="getDictLabel('deviceStatus', row.status, { labelKey: 'tagType' })">
          <el-tooltip v-if="row.status === 'unauthorized'" :content="$t('device.permission.error')">
            <el-icon><WarningFilled /></el-icon>
          </el-tooltip>
          {{ $t(getDictLabel('deviceStatus', row.status)) || '-' }}
        </el-tag>
        <div class="device-card-actions">
          <div class="flex items-center gap-1 !*:ml-0">
            <el-button v-if="['device', 'unauthorized'].includes(row.status)" type="primary" text circle icon="Iphone" title="桌面模式" class="desktop-launch-action" @click="openFusion(row)" />
            <ConnectAction
              v-if="['offline'].includes(row.status) && row.wifi"
              v-bind="{
                device: row,
                handleConnect,
              }"
            />

            <WirelessAction v-if="['device', 'unauthorized'].includes(row.status)" v-bind="{ row, handleConnect, handleRefresh }" />

            <RemoveAction
              v-if="['offline'].includes(row.status)"
              v-bind="{
                device: row,
                handleRefresh,
              }"
            />
          </div>
        </div>
      </article>
    </div>
  </div>
</template>

<script setup>
import { sleep } from '$/utils/index.js'

import AppEmpty from '$/components/app-empty/index.vue'
import Remark from './components/remark/index.vue'
import WirelessAction from './components/wireless-action/index.vue'
import ConnectAction from './components/connect-action/index.vue'
import RemoveAction from './components/remove-action/index.vue'
import DevicePopover from './components/device-popover/index.vue'

import { getDictLabel } from '$/dicts/helper'

const deviceStore = useDeviceStore()
const preferenceStore = usePreferenceStore()

function openFusion(row) {
  window.$preload.win.open('pages/desktop', { device: toRaw(row), fusionRole: 'launcher', show: false, instanceId: `fusion:${row.id}` })
}

const loading = ref(false)
const loadError = ref('')

const deviceList = computed({
  get: () => deviceStore.list,
  set: (val) => {
    deviceStore.list = val
  },
})

const autoFusionDevices = new Set()

async function getDeviceData(options = {}) {
  const { unloading = false } = options

  if (!unloading) {
    loading.value = true
  }

  try {
    loadError.value = ''
    await deviceStore.getList()
    loading.value = false
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
    const message = error?.message || error?.cause?.message || ''
    console.warn('Device list fetch error:', message)

    if (message) {
      ElMessage.warning(message)
    }

    loadError.value = message || '设备读取失败，请检查连接后重试'
  }
  finally {
    loading.value = false
  }
}

async function onAdbWatch(type, ret) {
  if (ret && ret.id) {
    await sleep(1000)
    getDeviceData()
  }
}

async function handleConnect(address) {
  try {
    await window.$preload.adb.connect(address)
  }
  catch (error) { ElMessage.warning(error.message) }
  await handleRefresh()
}

async function handleRefresh() {
  loading.value = true
  await sleep()
  await getDeviceData({ unloading: true })
}

let unAdbWatch = null

onMounted(async () => {
  await getDeviceData()
  unAdbWatch = await window.$preload.adb.watch(onAdbWatch)
})

onBeforeUnmount(() => {
  unAdbWatch?.()
})

onActivated(() => {
  getDeviceData()
})
</script>

<style lang="postcss" scoped>
.desktop-launch-action {
  transition:
    transform 0.15s ease,
    background-color 0.15s ease;
}
.desktop-launch-action:active {
  transform: scale(0.84);
  background-color: #ffffff26;
}
.device-cards {
  padding: 4px;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 240px), 280px));
  align-content: start;
  justify-content: center;
  scrollbar-gutter: stable both-edges;
  gap: 12px;
}
.device-card {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 12px;
  min-height: 104px;
  padding: 14px 16px;
  border: 1px solid var(--ui-border);
  border-radius: 16px;
  background: var(--ui-raised);
  align-items: center;
}
.device-card-identity {
  min-width: 0;
}
.device-card-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--ui-text);
}
.device-card-serial {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--ui-secondary);
  font-size: 12px;
  min-width: 0;
  margin-top: 8px;
}
.device-card-serial > span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.device-card-status {
  justify-self: end;
}
.device-card-actions {
  grid-column: 1 / -1;
  justify-self: end;
}
</style>
