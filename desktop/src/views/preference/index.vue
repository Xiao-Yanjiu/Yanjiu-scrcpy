<template>
  <div class="settings-page h-full flex flex-col overflow-hidden">
    <div class="flex-1 min-h-0">
      <PreferenceForm
        v-model="preferenceData"
        v-bind="{
          deviceScope,
        }"
      >
        <template #cards>
          <article class="extra-setting-card">
            <h2>无线桌面连接</h2>
            <WirelessGroup :handle-refresh="refreshDevices" />
          </article>
          <NotificationCompanion />
        </template>
      </PreferenceForm>
    </div>
  </div>
</template>

<script setup>
import { debounce } from 'lodash-es'

import WirelessGroup from '../device/components/wireless-group/index.vue'
import NotificationCompanion from './components/notification-companion.vue'

import PreferenceForm from '$/components/preference-form/index.vue'

const deviceStore = useDeviceStore()
async function refreshDevices() {
  await deviceStore.getList()
}
const preferenceStore = usePreferenceStore()
const themeStore = useThemeStore()

const preferenceData = computed({
  get() {
    return preferenceStore.data
  },
  set(value) {
    preferenceStore.data = value
  },
})

// This page edits the shared configuration only.
preferenceStore.setScope('global')
const deviceScope = 'global'

const handleSave = debounce(_handleSave, 500)

watchEffect(() => {
  themeStore.updateGlass({ glassOpacity: preferenceData.value.glassOpacity })
})

watch(() => JSON.stringify(preferenceData.value), () => {
  handleSave()
})

watch(() => preferenceData.value.theme, (val) => {
  themeStore.update(val)
})

function _handleSave() {
  preferenceStore.setData(preferenceData.value)
}
</script>

<style>
.extra-setting-card {
  border: 1px solid var(--ui-border);
  border-radius: 16px;
  background: var(--ui-raised);
  padding: 10px 12px;
  min-width: 0;
}
.extra-setting-card h2 {
  font-size: 14px;
  font-weight: 600;
  margin: 0 0 6px;
  line-height: 20px;
}
.extra-setting-card .w-72 {
  width: 100%;
}
</style>
