<template>
  <article class="extra-setting-card">
    <h2>手机实时通知</h2>
    <el-select v-model="deviceId" placeholder="选择已连接的手机">
      <el-option v-for="device in connectedDevices" :key="device.id" :value="device.id" :label="device.remark || device.name || device.id" />
    </el-select>
    <el-button class="mt-2" :disabled="!deviceId" :loading="installing" @click="setup">
      安装／设置通知助手
    </el-button>
  </article>
</template>

<script setup>
const deviceStore = useDeviceStore()
const connectedDevices = computed(() => deviceStore.list.filter(device => device.status === 'device'))
const deviceId = ref('')
const installing = ref(false)
watch(connectedDevices, (devices) => {
  if (!devices.some(device => device.id === deviceId.value))
    deviceId.value = devices[0]?.id || ''
}, { immediate: true })
async function setup() {
  installing.value = true
  try {
    await window.$preload.ipcRenderer.invoke('desktop-notification-setup', deviceId.value, { install: true })
    ElMessage.success('请在手机上开启通知使用权，之后无需手动打开通知助手')
  }
  catch (error) { ElMessage.warning(error.message) }
  finally { installing.value = false }
}
</script>
