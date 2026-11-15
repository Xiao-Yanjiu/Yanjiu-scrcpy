<template>
  <div class="relative flex items-center group">
    <Contenteditable
      :key="contenteditableKey"
      :model-value="modelValue"
      nowrap
      show-edit-button
      select-all-on-focus
      allow-empty
      actions-class="remark-actions"
      @confirm="onConfirm"
    />
  </div>
</template>

<script setup>
import Contenteditable from '$/components/contenteditable/index.vue'

const props = defineProps({
  device: {
    type: Object,
    default: () => ({}),
  },
})

const deviceStore = useDeviceStore()

const modelValue = computed(() => props.device.remark || props.device.name)

const contenteditableKey = ref(0)

function onConfirm(value) {
  deviceStore.setRemark(props.device.id, value)

  // If the value is empty, we need to force re-render the Contenteditable component to show the original value (device name) instead of an empty string.
  if (!value) {
    ++contenteditableKey.value
  }
}
</script>

<style scoped>
.group {
  min-width: 0;
  height: 28px;
  gap: 4px;
}
:deep(.remark-actions) {
  display: inline-flex;
  visibility: hidden;
  align-items: center;
}
.group:hover :deep(.remark-actions),
.group:focus-within :deep(.remark-actions) {
  visibility: visible;
}
:deep(.el-button) {
  width: 24px;
  height: 24px;
  min-height: 24px;
  padding: 0;
}
:deep([contenteditable]) {
  min-width: 0;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
