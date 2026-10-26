<template>
  <div class="w-full">
    <el-input
      :model-value="modelValue"
      readonly
      placeholder="点击后按组合键，Backspace 清除"
      @keydown.prevent.stop="capture"
    />
    <div class="text-xs opacity-60 mt-1">
      按一次隐藏本软件全部窗口，再按一次恢复；后台连接继续运行。
    </div>
    <div v-if="error" class="text-red-500 text-xs">
      {{ error }}
    </div>
  </div>
</template>

<script setup>
defineProps({ modelValue: { type: String, default: '' } })
const emit = defineEmits(['update:modelValue'])
const error = ref('')
async function capture(event) {
  if (['Control', 'Alt', 'Shift', 'Meta'].includes(event.key))
    return
  const clear
    = ['Backspace', 'Delete'].includes(event.key)
      && !event.ctrlKey
      && !event.altKey
      && !event.shiftKey
  if (!clear && !event.ctrlKey && !event.altKey && !event.metaKey) {
    error.value = '请至少包含 Ctrl、Alt 或 Win 键'
    return
  }
  const key = /^Key[A-Z]$/.test(event.code)
    ? event.code.slice(3)
    : /^Digit\d$/.test(event.code)
      ? event.code.slice(5)
      : event.key === ' '
        ? 'Space'
        : event.key
  const accelerator = clear
    ? ''
    : [
        event.ctrlKey && 'Control',
        event.altKey && 'Alt',
        event.shiftKey && 'Shift',
        event.metaKey && 'Super',
        key,
      ]
        .filter(Boolean)
        .join('+')
  const result = await window.$preload.ipcRenderer.invoke(
    'boss-key-set',
    accelerator,
  )
  error.value = result.error || ''
  if (result.success)
    emit('update:modelValue', accelerator)
}
</script>
