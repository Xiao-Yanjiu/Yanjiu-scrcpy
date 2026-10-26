<template>
  <div
    :class="[
      {
        'pl-20': $platform.is('macos') && !controlProps.custom,
      },
    ]"
    class="app-header app-region-drag flex items-center pt-2"
  >
    <div v-if="title || deviceName || $slots['device-name']" class="flex-none  flex items-center gap-4 overflow-hidden">
      <div v-if="title" class="text-sm font-semibold select-none pl-1 -mt-px max-w-96 truncate" :title="title">
        {{ title }}
      </div>

      <slot name="device-name">
        <el-tag v-if="deviceName" type="primary">
          <div class="flex items-center gap-2">
            {{ deviceName }}
          </div>
        </el-tag>
      </slot>
    </div>

    <div class="flex-1 min-w-0">
      <slot name="default"></slot>
    </div>

    <el-button class="theme-toggle app-region-no-drag" text circle :icon="darkTheme ? 'Sunny' : 'Moon'" :title="darkTheme ? '切换浅色主题' : '切换深色主题'" :aria-label="darkTheme ? '切换浅色主题' : '切换深色主题'" @click="toggleTheme" />
    <div v-if="$slots.right" class="flex-none">
      <slot name="right"></slot>
    </div>

    <AppControls
      v-if="$platform.is('windows', 'linux') || controlProps.custom"
      v-bind="{
        background: controlProps.background,
      }"
    />
  </div>
</template>

<script setup>
import AppControls from '$/components/app-controls/index.vue'

const props = defineProps({
  title: {
    type: String,
    default: '',
  },
  deviceName: {
    type: String,
    default: '',
  },
  controlProps: {
    type: Object,
    default: () => ({}),
  },
})
const themeStore = useThemeStore()
const preferenceStore = usePreferenceStore()
const darkTheme = computed(() => themeStore.value === 'dark' || (themeStore.value === 'system' && themeStore.isDark))
async function toggleTheme() {
  const theme = darkTheme.value ? 'light' : 'dark'
  preferenceStore.data.theme = theme
  window.$preload.store.set('common.theme', theme)
  await themeStore.update(theme)
}
</script>

<style>
.app-header {
  min-height: 48px;
  padding-top: 0 !important;
  gap: 12px;
}
.theme-toggle {
  flex: none;
  margin-left: 8px !important;
}
.app-header .el-segmented {
  --el-segmented-item-selected-bg-color: var(--ui-selected);
  --el-segmented-item-selected-color: var(--ui-text);
  background: transparent;
  border-radius: 16px;
  padding: 4px;
}
.app-header .el-segmented__item {
  min-height: 38px;
  padding: 0 18px;
  font-size: 16px;
  border-radius: 12px;
}
.app-header .el-segmented__item-selected {
  border-radius: 12px;
}
</style>
