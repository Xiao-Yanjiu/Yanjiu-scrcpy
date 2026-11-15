<template>
  <div class="settings-layout">
    <div class="settings-content">
      <el-form ref="elForm" :model="preferenceData" label-position="left" class="settings-form">
        <section v-for="(item, name) of visibleModel" :key="name" class="settings-category">
          <header class="settings-category-heading">
            <div><p>Yanjiu-scrcpy</p><h1>{{ $t(item.label) }}</h1></div>
            <el-button plain icon="RefreshLeft" @click="handleReset(name)">
              {{ $t('preferences.reset') }}
            </el-button>
          </header>
          <div class="settings-fields">
            <el-row class="settings-card-grid">
              <el-col
                v-for="(item_1, name_1) of subModel(item)"
                :key="name_1"
                :span="24"
                :lg="24"
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
              <slot name="cards" />
            </el-row>
          </div>
        </section>
      </el-form>
    </div>
  </div>
</template>

<script setup>
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

const preferenceModel = computed(() => {
  const removed = new Set(['theme', 'appCloseCode', 'saveDir', 'adbDir', 'gnirehtetDir', 'scrcpyDir', 'concurrencyLimit', 'scrcpyAppend', 'gnirehtetAppend', 'environmentVariables', 'autoMirror', 'floatControl', 'edgeHidden', 'gnirehtetFix', 'debug'])
  const common = preferenceStore.model.common
  const children = Object.fromEntries(Object.entries(common.children).filter(([key]) => !removed.has(key)))
  return { common: { ...common, label: '设置', children: { ...children, ...preferenceStore.model.fusion.children } } }
})

const visibleModel = computed(() => Object.fromEntries(
  Object.entries(preferenceModel.value).filter(([key]) => !props.excludes.includes(key)),
))

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
    ...preferenceStore.getDefaultData('fusion'),
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
  grid-template-columns: minmax(0, 1fr);
  gap: 20px;
  overflow: hidden;
}
.settings-content {
  overflow-y: auto;
  min-width: 0;
  border-radius: 24px;
  background: var(--ui-surface);
  border: 1px solid var(--ui-border);
  scrollbar-gutter: stable both-edges;
}
.settings-category {
  max-width: 1320px;
  margin: auto;
  padding: 18px;
}
.settings-category-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 0 4px 16px;
}
.settings-category-heading p {
  font-size: 12px;
  letter-spacing: 0.09em;
  color: var(--ui-muted);
  margin-bottom: 7px;
}
.settings-category-heading h1 {
  font-size: 22px;
  line-height: 1.25;
  font-weight: 650;
  letter-spacing: -0.03em;
}
.settings-fields :deep(.el-form-item) {
  display: flex;
  flex-direction: row;
  align-items: center;
  min-height: 60px;
  padding: 10px 16px;
  margin-bottom: 10px;
  background: var(--ui-raised);
  border: 1px solid var(--ui-border);
  border-radius: 16px;
}
.settings-fields :deep(.el-form-item__label) {
  height: auto;
  line-height: 1.5;
  padding: 0 16px 0 0;
  width: 160px;
  flex: none;
  margin: 0;
  font-size: 15px;
  color: var(--ui-text);
  white-space: normal;
}
.settings-fields :deep(.el-form-item__content) {
  min-width: 0;
  width: 0;
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
@media (max-width: 520px) {
  .settings-fields :deep(.el-form-item) {
    flex-direction: column;
    align-items: stretch;
    gap: 8px;
  }
  .settings-fields :deep(.el-form-item__label) {
    width: auto;
    padding: 0;
  }
  .settings-fields :deep(.el-form-item__content) {
    width: 100%;
  }
}
@media (max-width: 900px) {
  .settings-category {
    padding: 20px;
  }
  .settings-fields :deep(.el-col) {
    flex: 0 0 100%;
    max-width: 100%;
    margin-left: 0;
  }
}
</style>

<style scoped>
.settings-fields :deep(.settings-card-grid) {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 220px), 250px));
  justify-content: center;
  gap: 12px;
  margin: 0 !important;
}
.settings-fields :deep(.el-col) {
  max-width: 100%;
  width: auto;
  flex: none;
  padding: 0 !important;
  margin: 0;
}
.settings-fields :deep(.el-form-item) {
  flex-direction: column;
  align-items: stretch;
  min-height: 100px;
  margin-bottom: 0;
  padding: 12px 16px;
}
.settings-fields :deep(.el-form-item__label) {
  width: auto;
  padding: 0 0 8px;
}
.settings-fields :deep(.el-form-item__content) {
  width: 100%;
}
</style>

<style scoped>
.settings-fields :deep(.el-form-item),
.settings-fields :deep(.extra-setting-card) {
  min-height: 120px;
  height: 100%;
  overflow: visible;
  box-sizing: border-box;
}
.settings-fields :deep(.el-form-item__content) {
  flex: none;
}
.settings-fields :deep(.el-form-item__label) {
  min-height: 28px;
}
</style>
