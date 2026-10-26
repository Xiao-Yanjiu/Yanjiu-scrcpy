<template>
  <div class="settings-layout">
    <nav class="settings-sidebar" aria-label="设置分类">
      <button v-for="tab in tabsModel" :key="tab.value" type="button" class="settings-nav-item" :class="{ active: activeTab === tab.value }" :aria-current="activeTab === tab.value ? 'page' : undefined" @click="activeTab = tab.value">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path :d="categoryIcons[tab.value] || categoryIcons.common" /></svg>
        <span>{{ $t(tab.label) }}</span>
      </button>
    </nav>
    <div ref="settingsContent" class="settings-content">
      <el-form ref="elForm" :model="preferenceData" label-position="top" class="settings-form">
        <section v-for="(item, name) of visibleModel" :key="name" class="settings-category">
          <header class="settings-category-heading">
            <div><p>Yanjiu-scrcpy</p><h1>{{ $t(item.label) }}</h1></div>
            <el-button plain icon="RefreshLeft" @click="handleReset(name)">
              {{ $t('preferences.reset') }}
            </el-button>
          </header>
          <div class="settings-fields">
            <el-row :gutter="20">
              <el-col
                v-for="(item_1, name_1) of subModel(item)"
                :key="name_1"
                :span="item_1.span || 12"
                :lg="item_1.span || 12"
                :offset="item_1.offset || 0"
              >
                <el-form-item :label="$t(item_1.label)" :prop="item_1.field">
                  <template #label>
                    <div class="flex items-center">
                      <el-tooltip
                        v-if="item_1.tips"
                        popper-class="max-w-96"
                        effect="light"
                        :content="$t(item_1.tips)"
                        placement="bottom"
                      >
                        <el-link
                          class="mr-1 !text-base"
                          icon="InfoFilled"
                          type="warning"
                          underline="never"
                        >
                        </el-link>
                      </el-tooltip>
                      <div class="setting-field-label" :title="$t(item_1.label)">
                        {{ $t(item_1.label) }}
                      </div>
                    </div>
                  </template>

                  <component
                    :is="inputModel[item_1.type]"
                    v-model="preferenceData[item_1.field]"
                    v-bind="{
                      preferenceData,
                      deviceScope,
                      title: getTitle(item_1),
                      placeholder: $t(item_1.placeholder),
                      data: item_1,
                    }"
                  ></component>
                </el-form-item>
              </el-col>
            </el-row>
          </div>
        </section>
      </el-form>
    </div>
  </div>
</template>

<script setup>
import { omit } from 'lodash-es'

import { inputModel } from './components/index.js'

const props = defineProps({
  deviceScope: {
    type: String,
    default: '',
  },
  collapseProps: {
    type: Object,
    default: () => ({}),
  },
  excludes: {
    type: Array,
    default: () => [],
  },
  reverse: {
    type: Boolean,
    default: false,
  },
})

const preferenceData = defineModel('modelValue', {
  type: Object,
  default: () => ({}),
})

const preferenceStore = usePreferenceStore()

const activeTab = ref('common')

const tabsModel = computed(() => {
  const value = Object.entries(preferenceStore.model).reduce((arr, [key, item]) => {
    if (!props.excludes.includes(key)) {
      arr.push({
        label: item.label,
        value: key,
      })
    }

    return arr
  }, [])

  return value
})

const settingsContent = ref(null)
const preferenceModel = computed(() => omit(preferenceStore.model, props.excludes))
const visibleModel = computed(() => preferenceModel.value[activeTab.value] ? { [activeTab.value]: preferenceModel.value[activeTab.value] } : {})
watch(tabsModel, (tabs) => {
  if (!tabs.some(tab => tab.value === activeTab.value))
    activeTab.value = tabs[0]?.value || ''
}, { immediate: true })
watch(activeTab, () => {
  if (settingsContent.value)
    settingsContent.value.scrollTop = 0
})
const categoryIcons = {
  common: 'M9 3h6l1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1z M9 12a3 3 0 1 0 6 0 3 3 0 1 0-6 0',
  desktop: 'M3 4h18v13H3z M8 21h8 M12 17v4',
  fusion: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18 M12 3a4.5 4.5 0 0 1 0 9 4.5 4.5 0 0 0 0 9 M12 7h.01 M12 17h.01',
  video: 'M3 5h12v14H3z M15 10l6-4v12l-6-4',
  device: 'M7 2h10v20H7z M11 18h2',
  window: 'M3 4h18v16H3z M3 9h18 M7 6.5h.01 M10 6.5h.01',
  launch: 'M4 4h6v6H4z M14 4h6v6h-6z M4 14h6v6H4z M14 14h6v6h-6z',
  audio: 'M11 4 6 8H3v8h3l5 4z M15 8a6 6 0 0 1 0 8 M18 5a10 10 0 0 1 0 14',
  record: 'M4 5h16v14H4z M9 12a3 3 0 1 0 6 0 3 3 0 1 0-6 0',
  input: 'M2 6h20v12H2z M6 10h.01 M10 10h.01 M14 10h.01 M18 10h.01 M7 14h10',
  camera: 'M3 6h5l2-3h4l2 3h5v14H3z M8 12a4 4 0 1 0 8 0 4 4 0 1 0-8 0',
}

function getTitle(item) {
  if (item.options?.length) {
    const currentOption = item.options.find(option => option.value === preferenceData.value[item.field])

    if (currentOption) {
      return window.t(currentOption.placeholder || currentOption.label)
    }
  }

  return window.t(item.placeholder || item.label)
}

function subModel(item) {
  const children = item?.children || {}

  const value = {}

  Object.entries(children).forEach(([key, data]) => {
    const { hidden } = data

    let isVisible = !hidden

    if (Array.isArray(hidden) || typeof hidden === 'string') {
      isVisible = !hidden.includes(props.deviceScope)
    }

    if (isVisible) {
      value[key] = data
    }
  })

  return value
}

function handleReset(type) {
  preferenceData.value = {
    ...preferenceData.value,
    ...preferenceStore.getDefaultData(type),
  }
}

async function generateCommand() {
  const value = await preferenceStore.scrcpyParameter(preferenceData.value, {
    useRecord: true,
    useCamera: true,
  })

  return value
}

defineExpose({
  generateCommand,
})
</script>

<style scoped>
.settings-layout {
  height: 100%;
  display: grid;
  grid-template-columns: 208px minmax(0, 1fr);
  gap: 20px;
  overflow: hidden;
}
.settings-sidebar {
  padding: 18px 12px;
  overflow-y: auto;
  background: var(--ui-surface);
  border: 1px solid var(--ui-border);
  border-radius: 24px;
}
.settings-sidebar-heading {
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.08em;
  color: var(--ui-muted);
  padding: 8px 16px 18px;
}
.settings-nav-item {
  position: relative;
  display: flex;
  align-items: center;
  gap: 13px;
  width: 100%;
  min-height: 48px;
  padding: 11px 16px;
  margin-bottom: 6px;
  border-radius: 15px;
  color: var(--ui-secondary);
  text-align: left;
  cursor: pointer;
  transition:
    background 0.16s,
    color 0.16s,
    transform 0.16s;
}
.settings-nav-item:hover {
  background: var(--ui-hover);
  color: var(--ui-text);
}
.settings-nav-item.active {
  background: var(--ui-selected);
  color: var(--ui-text);
  font-weight: 600;
}
.settings-nav-item.active:before {
  content: '';
  position: absolute;
  left: 0;
  top: 15px;
  bottom: 15px;
  width: 3px;
  background: var(--ui-accent);
  border-radius: 4px;
}
.settings-nav-item:active {
  transform: scale(0.97);
}
.settings-nav-item svg {
  width: 21px;
  height: 21px;
  flex: none;
}
.settings-content {
  overflow-y: auto;
  min-width: 0;
  border-radius: 24px;
  background: var(--ui-surface);
  border: 1px solid var(--ui-border);
  scrollbar-gutter: stable;
}
.settings-category {
  max-width: 1320px;
  margin: auto;
  padding: 28px;
}
.settings-category-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 0 4px 26px;
}
.settings-category-heading p {
  font-size: 12px;
  letter-spacing: 0.09em;
  color: var(--ui-muted);
  margin-bottom: 7px;
}
.settings-category-heading h1 {
  font-size: 28px;
  line-height: 1.25;
  font-weight: 650;
  letter-spacing: -0.03em;
}
.settings-fields :deep(.el-form-item) {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  min-height: 102px;
  padding: 17px 18px;
  margin-bottom: 18px;
  background: var(--ui-raised);
  border: 1px solid var(--ui-border);
  border-radius: 20px;
}
.settings-fields :deep(.el-form-item__label) {
  height: auto;
  line-height: 1.5;
  padding: 0 0 11px;
  font-size: 15px;
  color: var(--ui-text);
  white-space: normal;
}
.settings-fields :deep(.el-form-item__content) {
  min-width: 0;
  width: 100%;
  flex: 1;
  align-items: center;
}
.settings-fields :deep(.el-form-item__content > .el-input),
.settings-fields :deep(.el-form-item__content > .el-select) {
  width: 100%;
}
.setting-field-label {
  white-space: normal;
  line-height: 1.5;
}
@media (max-width: 900px) {
  .settings-layout {
    grid-template-columns: 166px minmax(0, 1fr);
    gap: 12px;
  }
  .settings-category {
    padding: 20px;
  }
  .settings-nav-item {
    padding: 10px;
    gap: 10px;
  }
  .settings-fields :deep(.el-col) {
    flex: 0 0 100%;
    max-width: 100%;
    margin-left: 0;
  }
}
@media (prefers-reduced-motion: reduce) {
  .settings-nav-item {
    transition: none;
  }
}
</style>
