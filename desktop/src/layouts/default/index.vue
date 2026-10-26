<template>
  <div
    v-bind="$attrs"
    class="main-shell absolute inset-0 h-full flex flex-col overflow-hidden"
    :class="{ 'window-expanded': windowExpanded }"
  >
    <template v-if="$platform.is('windows') && !windowExpanded">
      <span v-for="edge in ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']" :key="edge" class="window-resize-edge" :class="`edge-${edge}`" aria-hidden="true" @pointerdown.stop.prevent="beginResize($event, edge)" @pointerup="endResize" @pointercancel="endResize" @lostpointercapture="endResize" />
    </template>
    <AppHeader
      class="flex-none"
    >
      <template #default>
        <div class="main-header-content">
          <div class="main-brand">
            <img :src="brandLogo" alt="" /><span>Yanjiu-scrcpy</span>
          </div>
          <el-segmented
            v-slot="{ item }"
            v-model="activeTab"
            :options="tabsModel"
            class="el-segmented--parent *:app-region-no-drag"
          >
            <div class="text-sm lg:text-base">
              {{ $t(item.label) }}
            </div>
          </el-segmented>
        </div>
      </template>

      <template #right>
        <QuickBar class="" />
      </template>
    </AppHeader>

    <div class="main-page flex-1 h-0 overflow-auto">
      <RouterView v-slot="{ Component }">
        <keep-alive>
          <component :is="Component" />
        </keep-alive>
      </RouterView>
    </div>
  </div>
  <AppUpdateDialog />
</template>

<script setup>
import brandLogo from '$electron/resources/build/logo.png'
import AppHeader from '$/components/app-header/index.vue'
import QuickBar from '$/components/quick-bar/index.vue'
import AppUpdateDialog from '$/hooks/use-app-update/dialog.vue'

defineOptions({
  inheritAttrs: false,
})

const router = useRouter()
const route = useRoute()
const windowExpanded = ref(false)
function beginResize(event, edge) {
  if (event.button !== 0)
    return
  event.currentTarget.setPointerCapture(event.pointerId)
  window.$preload.ipcRenderer.invoke('main-window-resize', edge)
}
function endResize() {
  window.$preload.ipcRenderer.invoke('main-window-resize', null)
}
const updateWindowState = (_event, state) => {
  windowExpanded.value = Boolean(state.expanded)
}
window.$preload.ipcRenderer.on('main-window-state', updateWindowState)
onBeforeUnmount(() => window.$preload.ipcRenderer.off('main-window-state', updateWindowState))

const tabsModel = [
  {
    label: 'menus.device.name',
    value: '/device',
  },
  {
    label: 'menus.preference.name',
    value: '/preference',
  },
]

const activeTab = computed({
  get() {
    return route.path
  },
  set(value) {
    router.push(value)
  },
})

provide('activeTab', activeTab)
</script>

<style scoped>
.main-shell {
  padding: 12px 16px 16px;
  gap: 16px;
  background: var(--ui-canvas);
  border-radius: 32px;
  clip-path: inset(0 round 32px);
  color: var(--ui-text);
}
.main-shell.window-expanded {
  border-radius: 0;
  clip-path: inset(0);
}
.window-resize-edge {
  position: absolute;
  z-index: 20000;
  -webkit-app-region: no-drag;
  touch-action: none;
}
.edge-n,
.edge-s {
  left: 32px;
  right: 32px;
  height: 6px;
  cursor: ns-resize;
}
.edge-n {
  top: 0;
}
.edge-s {
  bottom: 0;
}
.edge-e,
.edge-w {
  top: 32px;
  bottom: 32px;
  width: 6px;
  cursor: ew-resize;
}
.edge-e {
  right: 0;
}
.edge-w {
  left: 0;
}
.edge-ne,
.edge-nw,
.edge-se,
.edge-sw {
  width: 32px;
  height: 32px;
}
.edge-ne,
.edge-nw {
  top: 0;
}
.edge-se,
.edge-sw {
  bottom: 0;
}
.edge-ne,
.edge-se {
  right: 0;
}
.edge-nw,
.edge-sw {
  left: 0;
}
.edge-ne {
  clip-path: polygon(0 0, 100% 0, 100% 100%, 75% 100%, 75% 25%, 0 25%);
}
.edge-nw {
  clip-path: polygon(0 0, 100% 0, 100% 25%, 25% 25%, 25% 100%, 0 100%);
}
.edge-se {
  clip-path: polygon(75% 0, 100% 0, 100% 100%, 0 100%, 0 75%, 75% 75%);
}
.edge-sw {
  clip-path: polygon(0 0, 25% 0, 25% 75%, 100% 75%, 100% 100%, 0 100%);
}
.edge-ne,
.edge-sw {
  cursor: nesw-resize;
}
.edge-nw,
.edge-se {
  cursor: nwse-resize;
}
.main-header-content {
  display: flex;
  align-items: center;
  gap: 28px;
  min-width: 0;
}
.main-brand {
  display: flex;
  align-items: center;
  gap: 11px;
  font-size: 17px;
  font-weight: 650;
  white-space: nowrap;
  letter-spacing: -0.03em;
}
.main-brand img {
  width: 36px;
  height: 36px;
  border-radius: 13px;
  object-fit: cover;
  box-shadow: none;
}
.main-page {
  border-radius: 0;
  overflow: hidden;
  min-width: 0;
}
@media (max-width: 900px) {
  .main-shell {
    padding: 10px;
    gap: 12px;
  }
  .main-brand span {
    display: none;
  }
  .main-header-content {
    gap: 14px;
  }
}
</style>
