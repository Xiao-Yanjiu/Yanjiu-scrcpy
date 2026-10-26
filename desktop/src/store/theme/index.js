import { defineStore } from 'pinia'

export const useThemeStore = defineStore('app-theme', () => {
  const value = ref(window.$preload.store.get('common.theme') || 'system')
  const isDark = ref(window.$preload.store.get('common.isDark') || false)

  async function init(changeValue = value.value) {
    value.value = changeValue

    await invokeAppTheme('update', changeValue)

    isDark.value = await invokeAppTheme('isDark')
    window.$preload.store.set('common.isDark', isDark.value)

    await updateHtml(changeValue)
  }

  function setupWatcher() {
    for (const field of ['glassOpacity']) {
      window.$preload.store.onDidChange(`common.${field}`, () => updateGlass())
    }
    window.$preload.store.onDidChange('common.theme', (_value) => {
      if (value.value === _value) {
        updateHtml(_value)
        return false
      }

      init(_value)
    })

    window.$preload.store.onDidChange('common.isDark', (_value) => {
      if (isDark.value === _value) {
        return false
      }

      init()
    })
  }

  async function updateHtml(value) {
    if (value === 'system') {
      updateClass(isDark.value ? 'dark' : 'light')
      return
    }

    updateClass(value)
  }

  function updateClass(theme) {
    const htmlEl = document.documentElement

    if (theme === 'dark') {
      htmlEl.classList.remove('bg-gray-100')
      htmlEl.classList.add('dark')
      htmlEl.classList.remove('bg-gray-900')
      return
    }

    htmlEl.classList.remove('dark', 'bg-gray-900')
    htmlEl.classList.remove('bg-gray-100')
  }

  function updateGlass(settings = window.$preload.store.get('common') || {}) {
    const number = (value, fallback, min, max) => Number.isFinite(Number(value)) && value !== undefined && value !== null ? Math.min(max, Math.max(min, Number(value))) : fallback
    const root = document.documentElement.style
    root.setProperty('--glass-opacity', String(number(settings.glassOpacity, 78, 20, 100) / 100))
    root.setProperty('--glass-blur', '40px')
  }

  init()
  updateGlass()
  setupWatcher()

  return {
    value,
    isDark,
    init,
    update: init,
    updateHtml,
    updateGlass,
  }
})

function invokeAppTheme(key, value) {
  return window.$preload.ipcRenderer.invoke(`app-theme-${key}`, value)
}
