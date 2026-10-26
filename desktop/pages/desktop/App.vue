<template>
  <div
    ref="desktopEl"
    class="dex-workspace"
    :class="{ 'theme-light': appearance === 'light', 'fusion-launcher': isFusionLauncher, 'fusion-app': isFusionApp, 'fusion-fullscreen': fusionFullscreen }"
    :style="wallpaperStyle"
    @contextmenu.self.prevent="openPanel('wallpaper')"
    @pointerdown.capture="focusDesktopControl"
    @focusin.capture="focusDesktopControl"
  >
    <div v-if="!isFusion && !fullscreenId" class="device-chip" data-native-overlay>
      <span class="connection-dot" :class="{ online: connected }"></span>
      <span>{{ device?.remark || device?.name || deviceId }}</span>
      <small>{{ connected ? "已连接" : "等待连接 · 自动重连中" }}</small>
    </div>

    <button
      v-if="!isFusion && !fullscreenId"
      class="desktop-fullscreen-button icon-button"
      data-native-overlay
      :title="hostFullscreen ? '退出桌面全屏' : '桌面全屏'"
      @click="toggleHostFullscreen"
    >
      <DeskIcon :name="hostFullscreen ? 'restore' : 'expand'" />
    </button>
    <div v-if="!isFusion && preferences.desktopApps?.length" class="desktop-shortcuts">
      <button
        v-for="app in preferences.desktopApps"
        :key="app.packageName"
        class="desktop-shortcut"
        :title="app.name"
        :style="{ left: `${app.x}px`, top: `${app.y}px` }"
        @pointerdown="shortcutPointerDown($event, app)"
        @contextmenu.stop.prevent="openLauncherMenu($event, app)"
        @keydown.enter.prevent="launch(app)"
      >
        <img
          v-if="app.icon"
          :src="app.icon"
          alt=""
          draggable="false"
        /><DeskIcon v-else name="app" /><span>{{ app.name }}</span>
      </button>
    </div>
    <section
      v-for="item in windows"
      v-show="isWindowVisible(item)"
      :key="item.id"
      :ref="(el) => setShell(item.id, el)"
      :data-app-id="item.id"
      class="app-window"
      :class="{
        active: activeId === item.id,
        fullscreen: fullscreenId === item.id,
        maximized: item.maximized,
      }"
      :style="windowStyle(item)"
      @pointerdown.capture="activate(item)"
      @click="focusApp(item, $event)"
    >
      <header
        v-if="isFusionApp ? !fusionFullscreen : (fullscreenId !== item.id || item.config.captionPinned)"
        class="app-titlebar"
        :style="captionStyle(item)"
        :class="{
          revealed: isFusionApp || item.config.captionPinned || captionId === item.id || resolutionId === item.id || fusionSettingsOpen,
          dragging: captionPress?.id === item.id && captionPress.dragging,
        }"
        data-native-overlay
        role="button"
        tabindex="0"
        aria-label="应用控件：短按展开，长按拖动"
        @pointerdown="captionPointerDown($event, item)"
        @keydown.enter.self.prevent="toggleCaption(item)"
        @keydown.space.self.prevent="toggleCaption(item)"
      >
        <span class="caption-grip" aria-hidden="true"></span>
        <img v-if="item.icon" class="title-icon" :src="item.icon" alt="" />
        <DeskIcon v-else class="title-icon" name="app" />
        <span class="app-title">{{ item.name }}</span><button v-if="isFusionApp" class="fusion-settings-toggle" title="此应用的设置" :aria-expanded="fusionSettingsOpen" @pointerdown.stop @click="fusionSettingsOpen = !fusionSettingsOpen">
          <DeskIcon name="settings" /><DeskIcon name="chevron" />
        </button>
        <button
          class="rightclick-switch"
          :class="{ enabled: item.rightBack }"
          role="switch"
          :aria-checked="item.rightBack"
          aria-label="右键返回"
          :disabled="!item.ready || item.rightBusy"
          :title="
            item.rightBack
              ? '当前应用获得焦点时：鼠标右键返回'
              : '当前应用获得焦点时：正常鼠标右键'
          "
          @pointerdown.stop
          @dblclick.stop
          @click="toggleRightButton(item)"
        >
          <span class="rightclick-label">{{
            item.rightBack ? "右键返回" : "正常右键"
          }}</span><span class="switch-track"><i></i></span>
        </button>
        <button
          class="resolution-chip"
          title="分辨率与布局"
          @pointerdown.stop
          @dblclick.stop
          @click="editResolution(item)"
        >
          {{ item.config.width }} × {{ item.config.height
          }}<small>{{ item.config.dpi }} DPI</small>
        </button>
        <div class="window-actions" @pointerdown.stop @dblclick.stop>
          <button v-if="!isFusionApp" :title="item.config.captionPinned ? '取消固定标题栏' : '固定标题栏'" :aria-pressed="!!item.config.captionPinned" @click="toggleCaptionPin(item)">
            <DeskIcon :name="item.config.captionPinned ? 'lock' : 'unlock'" />
          </button>
          <button v-if="!isFusionApp" title="最小化" @click="minimize(item)">
            <DeskIcon name="minimize" />
          </button>
          <button :title="fusionFullscreen ? '退出全屏' : '应用全屏'" @click="enterFullscreen(item)">
            <DeskIcon :name="fusionFullscreen ? 'restore' : 'expand'" />
          </button>
          <button
            v-if="!isFusionApp"
            class="close-action"
            title="关闭应用窗口"
            @click="closeApp(item)"
          >
            <DeskIcon name="close" />
          </button>
        </div>
      </header>
      <div :ref="(el) => setView(item.id, el)" class="app-surface">
        <div v-if="!item.ready" class="surface-status">
          <img v-if="item.icon" :src="item.icon" alt="" />
          <span v-if="item.starting" class="spinner"></span>
          <p>
            {{ item.starting ? "正在打开应用…" : item.error || "等待手机连接" }}
          </p>
          <button v-if="!item.starting" @click="startApp(item)">
            重新连接应用
          </button>
        </div>
      </div>
      <template v-if="!isFusionApp && !item.maximized && fullscreenId !== item.id">
        <div
          v-for="edge in resizeEdges"
          :key="edge"
          class="resize-handle"
          data-native-overlay
          :class="edge"
          @pointerdown.stop.prevent="beginResize($event, item, edge)"
        ></div>
      </template>
    </section>

    <section v-if="isFusionApp && fusionSettingsOpen && windows[0]" class="fusion-app-settings glass" data-native-overlay @pointerdown.stop>
      <strong>{{ windows[0].name }} · 应用设置</strong>
      <button @click="editResolution(windows[0]); fusionSettingsOpen = false">
        分辨率、DPI 与布局 <DeskIcon name="chevron" />
      </button>
      <label><span>鼠标右键返回</span><input type="checkbox" :checked="windows[0].rightBack" :disabled="!windows[0].ready" @change="toggleRightButton(windows[0])" /></label>
      <label>鼠标模式<select :value="windows[0].config.mouse || ''" @change="setFusionInput('mouse', $event.target.value)"><option value="">跟随偏好</option><option value="sdk">SDK</option><option value="uhid">UHID</option><option value="disabled">禁用</option></select></label>
      <label>键盘模式<select :value="windows[0].config.keyboard || ''" @change="setFusionInput('keyboard', $event.target.value)"><option value="">跟随偏好</option><option value="sdk">SDK</option><option value="uhid">UHID</option><option value="disabled">禁用</option></select></label>
      <button @click="fusionSettingsOpen = false">
        收起设置
      </button>
    </section>
    <Transition
      name="panel"
      @before-enter="animatePanels"
      @before-leave="animatePanels"
      @after-enter="queueLayout"
      @after-leave="queueLayout"
    >
      <section v-if="drawerOpen || isFusionLauncher" class="start-menu glass" data-native-overlay>
        <div class="menu-search">
          <DeskIcon name="search" /><input
            ref="searchField"
            v-model="search"
            autofocus
            placeholder="搜索手机应用"
            @keydown.stop="searchKeydown"
            @compositionstart.stop
            @compositionend.stop
          />
          <button class="icon-button" title="刷新应用图标" @click="loadApps(true)">
            <DeskIcon name="refresh" />
          </button>
        </div>
        <div v-if="!search.trim()" class="frequent-apps">
          <div v-if="frequentApps.length" class="app-grid frequent-grid">
            <button
              v-for="app in frequentApps"
              :key="app.packageName"
              class="frequent-app"
              :title="app.packageName"
              @click="launch(app)"
              @contextmenu.stop.prevent="openLauncherMenu($event, app)"
            >
              <DeskIcon v-if="app.mirror" class="mirror-shortcut-icon" name="phone" /><img v-else :src="app.icon" alt="" /><span>{{ app.name }}</span>
            </button>
          </div>
          <p v-else class="muted frequent-empty">
            打开应用后会显示在这里
          </p>
        </div>
        <p v-if="appsLoading" class="muted">
          正在读取手机应用与图标…
        </p>
        <div class="app-grid">
          <button
            v-for="app in filteredApps"
            :key="app.packageName"
            class="launcher-app"
            :title="app.packageName"
            @contextmenu.stop.prevent="openLauncherMenu($event, app)"
            @click="launch(app)"
          >
            <img v-if="app.icon" :src="app.icon" alt="" loading="lazy" />
            <span v-else class="fallback-icon">{{
              app.name?.slice(0, 1)
            }}</span>
            <span>{{ app.name || app.packageName }}</span>
          </button>
        </div>
        <div v-if="!appsLoading && !filteredApps.length" class="muted empty">
          {{ connected ? "没有匹配的应用" : "连接手机后显示应用" }}
        </div>
        <footer class="menu-footer">
          <span><span class="connection-dot" :class="{ online: connected }"></span>{{ device?.name || "Android" }}</span><button
            class="icon-button"
            :title="isFusionLauncher ? '退出融合模式' : '控制中心'"
            @click="isFusionLauncher ? hostAction('close') : openPanel('control')"
          >
            <DeskIcon :name="isFusionLauncher ? 'power' : 'settings'" />
          </button>
        </footer>
      </section>
    </Transition>

    <Transition
      name="panel"
      @before-enter="animatePanels"
      @before-leave="animatePanels"
      @after-enter="queueLayout"
      @after-leave="queueLayout"
    >
      <aside v-if="panel === 'control'" class="quick-settings glass adb-control" data-native-overlay>
        <header class="adb-control-header">
          <strong>控制中心</strong><button class="icon-button" title="刷新状态" :disabled="controlReading" @click="loadControlState">
            <DeskIcon name="refresh" />
          </button><button class="icon-button" title="关闭" @click="closeOverlays">
            <DeskIcon name="close" />
          </button>
        </header>
        <div v-if="controlError" class="quick-error" role="status">
          {{ controlError }}
        </div>
        <div v-if="!controlReady" class="quick-loading">
          正在读取设备状态…
        </div>
        <div class="quick-grid">
          <div v-for="tile in quickTiles" :key="tile.key" class="quick-tile">
            <button :class="{ selected: phoneState[tile.key] }" :disabled="controlBusy || (!controlReady && tile.key !== 'settings')" :aria-label="tile.label" :aria-pressed="tile.key === 'settings' ? undefined : phoneState[tile.key]" :title="tile.key === 'settings' ? '在应用窗口中打开手机设置' : tile.label" @click="toggleControl(tile.key)" @contextmenu.prevent="toggleControl('settings')">
              <DeskIcon :name="tile.icon" />
            </button><span>{{ tile.label }}</span>
          </div>
        </div>
        <div class="adb-media">
          <button class="icon-button" title="上一首" :disabled="controlBusy" @click="controlMedia('previous')">
            <DeskIcon name="previous" />
          </button><button class="icon-button" title="播放／暂停" :disabled="controlBusy" @click="controlMedia('toggle')">
            <DeskIcon name="play" />
          </button><button class="icon-button" title="下一首" :disabled="controlBusy" @click="controlMedia('next')">
            <DeskIcon name="next" />
          </button>
        </div>
        <label class="adb-volume"><DeskIcon :name="phoneState.volume ? 'volume' : 'mute'" /><input v-model.number="phoneState.volume" type="range" min="0" max="100" aria-label="媒体音量" @pointerdown="levelChanges.volume.editing = true" @pointerup="levelChanges.volume.editing = false" @pointercancel="levelChanges.volume.editing = false" @input="queueLevel('volume', $event.target.value)" @change="setLevel('volume')" /><span>{{ phoneState.volume }}%</span></label>
      </aside>
    </Transition>

    <Transition
      name="panel"
      @before-enter="animatePanels"
      @before-leave="animatePanels"
      @after-enter="queueLayout"
      @after-leave="queueLayout"
    >
      <aside
        v-if="panel === 'notifications'"
        class="notification-panel glass"
        data-native-overlay
      >
        <div class="panel-heading">
          <strong>通知中心</strong><button
            class="clear-notifications"
            :disabled="
              notificationBusy
                || !notifications.some((notice) => notice.dismissible ?? !notice.ongoing)
            "
            @click="clearNotifications"
          >
            清空
          </button><button class="icon-button" title="刷新" @click="readNotifications">
            <DeskIcon name="refresh" />
          </button>
        </div>
        <p v-if="notificationsLoading" class="muted">
          正在同步通知…
        </p>
        <p v-else-if="!notifications.length" class="notification-empty">
          暂无通知
        </p>
        <section
          v-for="group in notificationGroups"
          :key="group.groupId"
          class="notification-group"
          :class="{ collapsed: group.items.length > 1 && !expandedNotificationGroups.has(group.groupId) }"
        >
          <header class="notification-app-heading">
            <img v-if="group.icon" :src="group.icon" alt="" /><DeskIcon
              v-else
              name="app"
            />
            <span>{{ group.appName }}</span><small v-if="group.items.length > 1">{{
              group.items.length
            }}</small><button v-if="group.items.length > 1" class="icon-button notification-expand" :aria-expanded="expandedNotificationGroups.has(group.groupId)" title="展开／收起通知" @click="expandedNotificationGroups.has(group.groupId) ? expandedNotificationGroups.delete(group.groupId) : expandedNotificationGroups.add(group.groupId)">
              <DeskIcon :name="expandedNotificationGroups.has(group.groupId) ? 'chevronUp' : 'chevronDown'" />
            </button>
          </header>
          <article
            v-for="notice in group.items"
            :key="notice.key"
            class="phone-notification"
            role="button"
            tabindex="0"
            @click="openNotification(notice)"
            @keydown.enter.self.prevent="openNotification(notice)"
            @keydown.space.self.prevent="openNotification(notice)"
          >
            <header>
              <strong>{{ notice.title || group.appName }}</strong><time v-if="notice.time">{{
                notificationTime(notice.time)
              }}</time><button
                v-if="notice.dismissible ?? !notice.ongoing"
                class="icon-button notification-dismiss"
                title="移除通知"
                :disabled="!!notificationBusy"
                @click.stop="dismissNotification(notice)"
              >
                <DeskIcon name="close" />
              </button>
            </header>
            <p v-if="notice.text && notice.text !== notice.title">
              {{ notice.text }}
            </p>
          </article>
        </section>
      </aside>
    </Transition>

    <Transition
      name="panel"
      @before-enter="animatePanels"
      @before-leave="animatePanels"
      @after-enter="queueLayout"
      @after-leave="queueLayout"
    >
      <aside
        v-if="panel === 'wallpaper'"
        class="personalization glass"
        data-native-overlay
      >
        <div class="panel-heading">
          <strong>个性化</strong><button class="icon-button" @click="closeOverlays">
            <DeskIcon name="close" />
          </button>
        </div>
        <div class="wallpaper-preview" :style="wallpaperStyle"></div>
        <label>界面主题<select
          :value="appearance"
          @change="changeAppearance($event.target.value)"
        >
          <option value="dark">深色主题</option>
          <option value="light">浅色主题</option>
        </select></label>
        <label>桌面背景<select
          :value="preferences.wallpaperSource"
          @change="changeWallpaperSource($event.target.value)"
        >
          <option value="default">默认壁纸</option>
          <option value="local">本地图片</option>
          <option value="phone-static">手机壁纸（静态）</option>
          <option value="phone-live">手机壁纸（动态）</option>
        </select></label>
        <div class="settings-buttons">
          <button @click="pickWallpaper">
            选择本地图片
          </button><button :disabled="wallpaperBusy" @click="syncPhoneWallpaper(true)">
            {{ wallpaperBusy ? "读取中…" : "获取手机壁纸" }}
          </button>
        </div>
        <p v-if="wallpaperError" class="inline-error">
          {{ wallpaperError }}
        </p>
        <p class="muted">
          静态保留当前壁纸，动态持续更新壁纸画面。
        </p>
        <label>壁纸显示<select
          v-model="preferences.wallpaperFit"
          @change="updateWallpaperFit"
        >
          <option value="cover">填充</option>
          <option value="contain">适应</option>
        </select></label>
        <div class="settings-buttons">
          <button @click="refresh(true)">
            刷新设备与应用
          </button>
        </div>
      </aside>
    </Transition>

    <Transition
      name="panel"
      @before-enter="animatePanels"
      @before-leave="animatePanels"
      @after-enter="queueLayout"
      @after-leave="queueLayout"
    >
      <aside
        v-if="resolutionId"
        class="resolution-panel glass"
        :style="resolutionPanelStyle"
        data-native-overlay
      >
        <div class="panel-heading">
          <strong>{{ resolutionApp?.name }} · 分辨率</strong><button class="icon-button" @click="resolutionId = ''">
            <DeskIcon name="close" />
          </button>
        </div>
        <label>应用布局<select
          v-model="resolutionForm.layout"
          @change="changeLayout"
        >
          <option value="device">原设备布局</option>
          <option value="tablet">平板布局</option>
          <option value="phone">手机布局</option>
        </select></label>
        <label>画面清晰度<select
          value=""
          @change="selectResolution($event.target.value)"
        >
          <option value="" disabled>选择预设分辨率</option>
          <option
            v-for="(preset, index) in presets"
            :key="preset.label"
            :value="index"
          >
            {{ preset.label }}
          </option>
        </select></label>
        <div class="resolution-fields">
          <label>宽度<input
            v-model.number="resolutionForm.width"
            type="number"
            min="320"
            max="3840"
            @input="matchDensity"
          /></label><span>×</span><label>高度<input
            v-model.number="resolutionForm.height"
            type="number"
            min="320"
            max="3840"
            @input="matchDensity"
          /></label>
        </div>
        <label>DPI<input
          v-model.number="resolutionForm.dpi"
          type="number"
          min="100"
          max="640"
          @input="
            resolutionForm.lockLogical = false;
            resolutionForm.layout
              = resolutionForm.width < resolutionForm.height
                ? 'phone'
                : 'tablet';
          "
        /></label>
        <label class="checkbox-label"><input
          v-model="resolutionForm.lockLogical"
          type="checkbox"
          @change="matchDensity"
        />改变清晰度时保持逻辑布局尺寸</label>
        <p class="muted">
          当前约 {{ logicalWidth }} ×
          {{ logicalHeight }}
          dp。{{
            resizeMode === "aspect"
              ? "拖动边框保持画面比例，只改变显示大小。"
              : "松开边框后根据窗口尺寸重新排版应用内容。"
          }}
        </p>
        <p v-if="resolutionError" class="inline-error">
          {{ resolutionError }}
        </p>
        <div class="settings-buttons">
          <button
            :disabled="resolutionBusy"
            class="primary-button"
            @click="applyResolution(false)"
          >
            {{ resolutionBusy ? "应用中…" : "应用并记住" }}
          </button><button
            v-if="resolutionError"
            :disabled="resolutionBusy"
            @click="applyResolution(true)"
          >
            保存并重新打开
          </button>
        </div>
      </aside>
    </Transition>

    <footer v-if="!isFusion && !fullscreenId" class="taskbar" data-native-overlay>
      <div class="taskbar-center">
        <button
          class="task-button start-button"
          :class="{ selected: drawerOpen }"
          title="应用"
          @click="toggleDrawer"
        >
          <DeskIcon name="start" />
        </button>
        <button
          v-for="item in taskbarApps"
          :key="item.packageName"
          class="task-button"
          :class="{
            'running-app': windows.some((entry) => entry.id === item.id),
            'selected': windows.some(
              (entry) =>
                entry.id === item.id
                && activeId === item.id
                && !entry.minimized,
            ),
            'dragging': draggingTask === item.packageName,
          }"
          :title="item.name"
          draggable="true"
          @dragstart="startTaskDrag($event, item)"
          @dragover.prevent="dragOverTask(item)"
          @drop.prevent="dropTask"
          @dragend="dropTask"
          @click="taskbarClick(item)"
          @contextmenu.stop.prevent="openTaskMenu($event, item)"
        >
          <img v-if="item.icon" :src="item.icon" alt="" /><DeskIcon
            v-else
            name="app"
          /><i v-if="windows.some((entry) => entry.id === item.id)"></i>
        </button>
      </div>
      <div class="system-tray">
        <button
          class="tray-controls"
          :title="isFusionLauncher ? '退出融合模式' : '控制中心'"
          @click="isFusionLauncher ? hostAction('close') : openPanel('control')"
        >
          <DeskIcon :name="phoneState.wifi ? 'wifi' : 'monitor'" /><DeskIcon
            :name="phoneState.volume ? 'volume' : 'mute'"
          /><span class="device-battery" :title="batteryLevel === null ? '设备电量读取中' : `设备电量 ${batteryLevel}%${batteryCharging ? ' · 充电中' : ''}`" role="img" :aria-label="batteryLevel === null ? '设备电量未知' : `设备电量 ${batteryLevel}%`"><svg viewBox="0 0 39 20" aria-hidden="true"><rect class="battery-body" x="1" y="3" width="29" height="14" rx="4" /><rect v-if="batteryLevel !== null" class="battery-fill" x="3" y="5" :width="25 * Math.max(0, Math.min(100, batteryLevel)) / 100" height="10" rx="2" /><path class="battery-tip" d="M32 7v6" /><text x="15.5" y="10.5" text-anchor="middle" dominant-baseline="middle">{{ batteryLevel === null ? '–' : batteryLevel }}</text><path v-if="batteryCharging" class="battery-charge" d="m37 2-5 9h4l-2 7 6-10h-4z" /></svg></span>
        </button>
        <button
          class="tray-clock"
          title="通知中心"
          @click="openPanel('notifications')"
        >
          <span>{{ clock }}</span><span>{{ date }}</span>
        </button>
        <button
          class="show-desktop"
          title="显示桌面"
          @click="showDesktop"
        ></button>
      </div>
    </footer>

    <Transition
      name="panel"
      @before-enter="animatePanels"
      @before-leave="animatePanels"
      @after-enter="queueLayout"
      @after-leave="queueLayout"
    >
      <aside
        v-if="taskMenu"
        class="task-context-menu glass"
        :style="taskMenuStyle"
        data-native-overlay
        role="menu"
      >
        <div class="task-menu-title">
          {{ taskMenu.name }}
        </div>
        <button role="menuitem" @click="toggleTaskPin">
          {{ isPinned(taskMenu) ? "取消固定到任务栏" : "固定到任务栏" }}
        </button>
        <button
          v-if="
            windows.some((item) => item.packageName === taskMenu.packageName)
          "
          role="menuitem"
          @click="closeTaskApp"
        >
          关闭应用
        </button>
        <button v-else role="menuitem" @click="launch(taskMenu)">
          打开应用
        </button>
      </aside>
    </Transition>

    <Transition
      name="panel"
      @before-enter="animatePanels"
      @before-leave="animatePanels"
      @after-enter="queueLayout"
      @after-leave="queueLayout"
    >
      <aside
        v-if="launcherMenu"
        class="launcher-context-menu task-context-menu glass"
        :style="launcherMenu.style"
        data-native-overlay
        role="menu"
      >
        <div class="task-menu-title">
          {{ launcherMenu.app.name }}
        </div>
        <button role="menuitem" @click="toggleDesktopShortcut">
          {{
            preferences.desktopApps?.some(
              (item) => item.packageName === launcherMenu.app.packageName,
            )
              ? "移除桌面快捷方式"
              : "添加到桌面"
          }}
        </button>
      </aside>
    </Transition>
    <TransitionGroup
      name="panel"
      tag="div"
      class="notification-banners"
      @before-enter="animatePanels"
      @before-leave="animatePanels"
      @after-enter="queueLayout"
      @after-leave="queueLayout"
    >
      <article
        v-for="banner in notificationBanners"
        :key="banner.id"
        class="notification-banner glass"
        data-native-overlay
        role="button"
        tabindex="0"
        @click="
          openNotification(banner.notice);
          dismissBanner(banner.id);
        "
        @keydown.enter.prevent="
          openNotification(banner.notice);
          dismissBanner(banner.id);
        "
        @mouseenter="pauseBanner(banner.id)"
        @mouseleave="resumeBanner(banner.id)"
      >
        <header>
          <img
            v-if="banner.notice.icon"
            :src="banner.notice.icon"
            alt=""
          /><strong>{{ banner.notice.appName }}</strong><button
            class="icon-button"
            title="关闭提示"
            @click.stop="dismissBanner(banner.id)"
          >
            <DeskIcon name="close" />
          </button>
        </header>
        <strong>{{ banner.notice.title }}</strong>
        <p>{{ banner.notice.text }}</p>
      </article>
    </TransitionGroup>
    <div
      v-if="fullscreenId || fusionFullscreen"
      class="fullscreen-float"
      :class="{ expanded: floatOpen }"
    >
      <button
        class="float-ball"
        data-native-overlay
        title="桌面快捷操作"
        @click="floatOpen = !floatOpen"
      >
        <DeskIcon name="start" />
      </button>
      <Transition
        name="panel"
        @before-enter="animatePanels"
        @before-leave="animatePanels"
        @after-enter="queueLayout"
        @after-leave="queueLayout"
      >
        <div v-if="floatOpen" class="float-menu glass" data-native-overlay>
          <button @click="exitFullscreen">
            <DeskIcon name="restore" />退出全屏
          </button>
        </div>
      </Transition>
    </div>

    <div v-if="initializing && !isFusion" class="boot-screen glass" data-native-overlay>
      <div class="boot-mark">
        <DeskIcon name="start" />
      </div>
      <h2>正在准备安卓桌面</h2>
      <p>{{ bootStep }}</p>
      <div class="boot-track">
        <span :style="{ width: `${bootProgress}%` }"></span>
      </div>
    </div>
    <div v-if="toast" class="toast glass" data-native-overlay>
      {{ toast }}
    </div>
  </div>
</template>

<script setup>
import DeskIcon from './DeskIcon.vue'

const fusionRole = window.$preload.payload?.fusionRole || ''
const isFusionLauncher = fusionRole === 'launcher'
const isFusionApp = fusionRole === 'app'
const isFusion = isFusionLauncher || isFusionApp
if (isFusion)
  document.title = isFusionLauncher ? '融合模式' : (window.$preload.payload.fusionApp?.name || '手机应用')
const fusionSettingsOpen = ref(false)
const fusionCaptionHidden = ref(false)
let fusionAppStarted = false
function fusionBlur() {
  if (isFusionLauncher)
    closeOverlays()
}
const deviceStore = useDeviceStore()
const themeStore = useThemeStore()
const appearance = computed(() =>
  themeStore.value === 'light'
  || (themeStore.value === 'system' && !themeStore.isDark)
    ? 'light'
    : 'dark',
)
function changeAppearance(value) {
  window.$preload.store.set('common.theme', value)
  themeStore.update(value)
}
const deviceId = window.$preload.payload?.device?.id || ''
const device = computed(() =>
  deviceStore.list.find(item => item.id === deviceId),
)
const connectionLost = ref(false)
let deviceWasConnected = false
let disconnectClosing = false
const connected = computed(
  () => device.value?.status === 'device' && !connectionLost.value,
)
const desktopEl = ref(null)
const windows = ref([])
const activeId = ref('')
const fullscreenId = ref('')
const drawerOpen = ref(false)
const panel = ref('')
const floatOpen = ref(false)
const taskMenu = ref(null)
const launcherMenu = ref(null)
const shortcutPress = shallowRef(null)
const notificationBanners = ref([])
const notificationBusy = ref('')
const bannerTimers = new Map()
let bannerSequence = 0
let notificationSeeded = false
let notificationPolling = false
let knownNotifications = new Map()
let notificationPollTimer = 0
const draggingTask = ref('')
let lastTaskDrop = 0
const captionId = ref('')
const captionPress = shallowRef(null)
const taskMenuStyle = ref({})
const levelChanges = {
  volume: {
    revision: 0,
    pending: null,
    running: false,
    editing: false,
    timer: null,
  },
  brightness: {
    revision: 0,
    pending: null,
    running: false,
    editing: false,
    timer: null,
  },
}
const search = ref('')
const searchField = ref(null)
const hostInputActive = ref(false)
let hostFocusPending = null
let hostFocusGeneration = 0
function isDesktopEditor(element) {
  return element instanceof HTMLElement && Boolean(element.closest('input, textarea, select, [contenteditable="true"]'))
}
function requestHostInput(active = true) {
  const pending = active && hostInputActive.value && hostFocusPending
  hostInputActive.value = active
  if (pending)
    return hostFocusPending
  const generation = ++hostFocusGeneration
  const promise = window.$preload.ipcRenderer.invoke('desktop-host-input', active).catch(() => false)
  if (!active) {
    hostFocusPending = null
    return promise
  }
  hostFocusPending = promise.finally(() => {
    if (generation === hostFocusGeneration)
      hostFocusPending = null
  })
  return hostFocusPending
}
function searchKeydown(event) {
  if (event.key === 'Escape' || (event.ctrlKey && event.code === 'Space')) {
    event.preventDefault()
    closeOverlays()
  }
}
watch(drawerOpen, async (open) => {
  if (!open)
    return
  await nextTick()
  await requestHostInput()
  if (drawerOpen.value)
    searchField.value?.focus({ preventScroll: true })
})
const apps = ref([])
const appsLoading = ref(false)
const initializing = ref(true)
const bootStep = ref('检查设备连接')
const bootProgress = ref(12)
const batteryLevel = ref(null)
const batteryCharging = ref(false)
const phoneState = reactive({
  wifi: false,
  bluetooth: false,
  airplane: false,
  powerSave: false,
  dark: false,
  volume: 50,
  brightness: 50,
})
const controlBusy = ref(false)
const notifications = ref([])
const notificationsLoading = ref(false)
const expandedNotificationGroups = reactive(new Set())
const notificationGroups = computed(() => {
  const groups = new Map()
  for (const notice of notifications.value) {
    const groupId = notice.groupId || notice.packageName
    if (!groups.has(groupId)) {
      groups.set(groupId, {
        groupId,
        packageName: notice.packageName,
        appName: notice.appName,
        icon: notice.icon,
        items: [],
      })
    }
    groups.get(groupId).items.push(notice)
  }
  return [...groups.values()]
})
function notificationTime(time) {
  return new Date(time).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}
const clock = ref('')
const date = ref('')
const hostFullscreen = ref(false)
const fusionFullscreen = computed(() => isFusionApp && hostFullscreen.value)
function fusionOpen() {
  if (isFusionLauncher)
    drawerOpen.value = true
}
function hostFullscreenChanged(_event, value) {
  hostFullscreen.value = Boolean(value)
  queueLayout()
}

const controlReady = ref(false)
const controlError = ref('')
const controlReading = ref(false)
let controlGeneration = 0
let controlRevision = 0
let controlPoll = 0
function applyControlState(state) {
  if (!state)
    return
  for (const [key, value] of Object.entries(state)) {
    const change = levelChanges[key]
    if (!change || (!change.editing && !change.running && !change.pending))
      phoneState[key] = value
  }
  controlReady.value = true
  controlError.value = ''
}
async function loadControlState() {
  if (panel.value !== 'control' || controlReading.value || controlBusy.value)
    return
  const generation = controlGeneration
  const revision = controlRevision
  controlReading.value = true
  try {
    const state = await window.$preload.ipcRenderer.invoke('desktop-control-state')
    if (panel.value === 'control' && generation === controlGeneration && revision === controlRevision && !controlBusy.value)
      applyControlState(state)
  }
  catch (error) {
    if (generation === controlGeneration)
      controlError.value = error.message
  }
  finally { controlReading.value = false }
}
async function startControlCenter() {
  const generation = ++controlGeneration
  controlError.value = ''
  try {
    const state = await window.$preload.ipcRenderer.invoke('desktop-control-open', deviceId)
    if (panel.value === 'control' && generation === controlGeneration)
      applyControlState(state)
  }
  catch (error) {
    if (generation === controlGeneration)
      controlError.value = error.message
  }
}
async function controlMedia(action) {
  if (controlBusy.value)
    return
  controlBusy.value = true
  try {
    await window.$preload.ipcRenderer.invoke('desktop-control-media', action)
  }
  catch (error) { controlError.value = error.message }
  finally { controlBusy.value = false }
}
watch(panel, (value, previous) => {
  clearInterval(controlPoll)
  if (previous === 'control' && value !== 'control') {
    ++controlGeneration
    window.$preload.ipcRenderer.invoke('desktop-control-close').catch(() => {})
  }
  if (value === 'control') {
    startControlCenter()
    controlPoll = setInterval(loadControlState, 3000)
  }
})

const resizeMode
  = window.$preload.store.get('desktopMode')?.desktopResizeMode || 'aspect'
const toast = ref('')
const wallpaperBusy = ref(false)
const liveWallpaper = ref(false)
const liveWallpaperFrame = ref('')
const wallpaperError = ref('')
const resolutionId = ref('')
const resolutionBusy = ref(false)
const resolutionError = ref('')
watch(drawerOpen, (value) => {
  if (isFusionLauncher)
    window.$preload.ipcRenderer.invoke('desktop-fusion-launcher', value).catch(error => notify(error.message))
})
watch(fusionSettingsOpen, () => {
  queueLayout()
})
watch([drawerOpen, panel, resolutionId, fusionSettingsOpen], ([drawer, activePanel, resolution, settings]) => {
  requestHostInput(Boolean(drawer || activePanel || resolution || settings))
})
function focusDesktopControl(event) {
  if (isDesktopEditor(event.target))
    requestHostInput()
  else if (event.type === 'pointerdown' && !event.target.closest('[data-native-overlay]') && !drawerOpen.value && !panel.value && !resolutionId.value && !fusionSettingsOpen.value)
    requestHostInput(false)
}

const resolutionForm = reactive({
  width: 1440,
  height: 900,
  dpi: 200,
  layout: 'device',
  lockLogical: true,
})
const resolutionApp = computed(() =>
  windows.value.find(item => item.id === resolutionId.value),
)
const resolutionPanelStyle = computed(() => {
  const item = resolutionApp.value
  if (!item)
    return {}
  const area = workSize()
  return {
    right: 'auto',
    left: `${Math.max(8, Math.min(area.width - 384, item.x + item.width - 384))}px`,
    top: `${Math.max(8, Math.min(area.height - 420, item.y + 48))}px`,
  }
})
const logicalWidth = computed(() =>
  Math.round((resolutionForm.width * 160) / resolutionForm.dpi),
)
const logicalHeight = computed(() =>
  Math.round((resolutionForm.height * 160) / resolutionForm.dpi),
)
const saved = window.$preload.store.get('androidDesktop') || {}
const preferenceKey = ref(deviceId)
const preferences = reactive({
  wallpaperSource: 'default',
  wallpaperImage: '',
  wallpaperFit: 'cover',
  appConfigs: {},
  appWindows: {},
  desktopApps: [],
  appUsage: {},
  pinnedApps: [],
  taskbarOrder: [],
  ...saved[deviceId],
})
if (preferences.wallpaperSource === 'phone')
  preferences.wallpaperSource = 'phone-live'
const wallpaperStyle = computed(() => ({
  backgroundImage:
    (liveWallpaperFrame.value || preferences.wallpaperImage)
    && preferences.wallpaperSource !== 'default'
      ? `url("${liveWallpaperFrame.value || preferences.wallpaperImage}")`
      : '',
  backgroundSize: preferences.wallpaperFit,
}))
const filteredApps = computed(() =>
  apps.value.filter(item =>
    `${item.name} ${item.packageName}`
      .toLowerCase()
      .includes(search.value.toLowerCase()),
  ),
)
const taskbarApps = computed(() => {
  const pinned = (preferences.pinnedApps || []).map(
    app =>
      windows.value.find(item => item.packageName === app.packageName) || {
        ...app,
        id: app.packageName,
      },
  )
  const entries = [
    ...pinned,
    ...windows.value.filter(
      item => !pinned.some(app => app.packageName === item.packageName),
    ),
  ]
  const order = preferences.taskbarOrder || []
  return entries.sort((a, b) => {
    const aIndex = order.indexOf(a.packageName)
    const bIndex = order.indexOf(b.packageName)
    return (
      (aIndex < 0 ? order.length : aIndex)
      - (bIndex < 0 ? order.length : bIndex)
    )
  })
})
function isPinned(app) {
  return (preferences.pinnedApps || []).some(
    item => item.packageName === app.packageName,
  )
}
function openTaskMenu(event, item) {
  closeOverlays()
  taskMenu.value = item
  taskMenuStyle.value = {
    left: `${Math.max(8, Math.min(event.clientX, (desktopEl.value?.clientWidth || 1280) - 228))}px`,
    bottom: '64px',
  }
  queueLayout()
}
function toggleTaskPin() {
  const app = taskMenu.value
  if (!app)
    return
  preferences.pinnedApps = isPinned(app)
    ? preferences.pinnedApps.filter(
        item => item.packageName !== app.packageName,
      )
    : [
        ...(preferences.pinnedApps || []),
        { packageName: app.packageName, name: app.name, icon: app.icon },
      ]
  savePreferences()
  closeOverlays()
}
function closeTaskApp() {
  const app = windows.value.find(
    item => item.packageName === taskMenu.value?.packageName,
  )
  closeOverlays()
  if (app)
    closeApp(app)
}
function startTaskDrag(event, item) {
  draggingTask.value = item.packageName
  event.dataTransfer.effectAllowed = 'move'
  event.dataTransfer.setData('text/plain', item.packageName)
  closeOverlays()
}
function dragOverTask(item) {
  if (!draggingTask.value || draggingTask.value === item.packageName)
    return
  const order = taskbarApps.value.map(app => app.packageName)
  const source = order.indexOf(draggingTask.value)
  const target = order.indexOf(item.packageName)
  if (source < 0 || target < 0)
    return
  order.splice(source, 1)
  order.splice(target, 0, draggingTask.value)
  preferences.taskbarOrder = [
    ...order,
    ...(preferences.taskbarOrder || []).filter(id => !order.includes(id)),
  ]
}
function dropTask() {
  if (!draggingTask.value)
    return
  draggingTask.value = ''
  lastTaskDrop = Date.now()
  savePreferences()
}
function taskbarClick(item) {
  if (Date.now() - lastTaskDrop < 300)
    return
  if (windows.value.some(app => app.id === item.id))
    taskClick(item)
  else launch(item)
}
const frequentApps = computed(() => [
  { packageName: '__phone_mirror__', name: '手机镜像', mirror: true },
  ...apps.value
    .filter(app => preferences.appUsage?.[app.packageName]?.count)
    .sort(
      (a, b) =>
        preferences.appUsage[b.packageName].count
        - preferences.appUsage[a.packageName].count
        || preferences.appUsage[b.packageName].lastUsed
        - preferences.appUsage[a.packageName].lastUsed,
    )
    .slice(0, 5),
])
function openLauncherMenu(event, app) {
  if (app.mirror)
    return
  launcherMenu.value = {
    app,
    style: {
      left: `${Math.max(8, Math.min(event.clientX, innerWidth - 236))}px`,
      top: `${Math.max(8, Math.min(event.clientY, innerHeight - 160))}px`,
      bottom: 'auto',
    },
  }
  taskMenu.value = null
  queueLayout()
}
function toggleDesktopShortcut() {
  const app = launcherMenu.value.app
  preferences.desktopApps ||= []
  const index = preferences.desktopApps.findIndex(
    item => item.packageName === app.packageName,
  )
  if (index >= 0) {
    preferences.desktopApps.splice(index, 1)
  }
  else {
    const count = preferences.desktopApps.length
    preferences.desktopApps.push({
      packageName: app.packageName,
      name: app.name,
      icon: app.icon,
      x: 24 + Math.floor(count / 6) * 94,
      y: 78 + (count % 6) * 96,
    })
  }
  launcherMenu.value = null
  savePreferences()
  queueLayout()
}
function shortcutPointerDown(event, app) {
  if (event.button !== 0)
    return
  event.preventDefault()
  clearTimeout(shortcutPress.value?.timer)
  event.currentTarget.setPointerCapture(event.pointerId)
  const press = {
    app,
    pointerId: event.pointerId,
    x: event.clientX,
    y: event.clientY,
    initialX: app.x,
    initialY: app.y,
    lastX: event.clientX,
    lastY: event.clientY,
    dragging: false,
    timer: null,
  }
  shortcutPress.value = press
  press.timer = setTimeout(() => {
    if (shortcutPress.value === press) {
      press.dragging = true
      shortcutPress.value = { ...press }
    }
  }, 350)
}
const presets = [
  { label: '标准 · 1440 × 900', width: 1440, height: 900 },
  { label: '高清 · 1920 × 1200', width: 1920, height: 1200 },
  { label: '超清 · 2560 × 1600', width: 2560, height: 1600 },
  { label: '手机 · 1080 × 1920', width: 1080, height: 1920 },
]
const quickTiles = [
  { key: 'wifi', icon: 'wifi', label: 'WLAN' },
  { key: 'bluetooth', icon: 'bluetooth', label: '蓝牙' },
  { key: 'airplane', icon: 'airplane', label: '飞行模式' },
  { key: 'powerSave', icon: 'battery', label: '省电模式' },
  { key: 'dark', icon: 'moon', label: '深色模式' },
  { key: 'rotation', icon: 'rotation', label: '方向锁定' },
  { key: 'location', icon: 'location', label: '定位服务' },
  { key: 'cellular', icon: 'cellular', label: '移动数据' },
  { key: 'settings', icon: 'settings', label: '手机设置' },
]
const resizeEdges = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']
const shells = new Map()
const views = new Map()
let zOrder = 1
let layoutFrame = 0
let refreshTimer, clockTimer, wallpaperTimer, toastTimer
let notificationRequest = 0
let refreshing = false
let preferencesReady = false
let restoreVolume = 50
let observer
let gesture = null

function setShell(id, element) {
  element ? shells.set(id, element) : shells.delete(id)
}
function hostAction(action) {
  window.$preload.ipcRenderer
    .invoke('desktop-host-action', action)
    .catch(error => notify(error.message))
}
function setView(id, element) {
  element ? views.set(id, element) : views.delete(id)
}
function notify(message) {
  toast.value = message
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => {
    toast.value = ''
    queueLayout()
  }, 5000)
  queueLayout()
}
function toggleCaption(item) {
  const open = captionId.value !== item.id
  closeOverlays()
  captionId.value = open ? item.id : ''
  queueLayout()
}
function captionPointerDown(event, item) {
  if (isFusionApp)
    return
  if (event.button !== 0 || event.target.closest('button'))
    return
  event.preventDefault()
  cancelCaptionPress()
  activate(item)
  event.currentTarget.setPointerCapture(event.pointerId)
  const press = {
    id: item.id,
    pointerId: event.pointerId,
    x: event.clientX,
    y: event.clientY,
    lastX: event.clientX,
    lastY: event.clientY,
    element: event.currentTarget,
    dragging: false,
    fusion: isFusionApp,
    timer: null,
  }
  if (press.fusion)
    window.$preload.ipcRenderer.invoke('desktop-host-action', 'drag-start')
  captionPress.value = press
  press.timer = setTimeout(() => {
    if (captionPress.value !== press)
      return
    press.dragging = true
    captionPress.value = { ...press }
    if (press.fusion) {
      window.$preload.ipcRenderer.invoke('desktop-host-action', 'drag-move')
      return
    }
    captureGesture(
      {
        button: 0,
        clientX: press.x,
        clientY: press.y,
        pointerId: press.pointerId,
        currentTarget: press.element,
        preventDefault() {},
      },
      item,
      '',
    )
    pointerMove({
      pointerId: press.pointerId,
      clientX: press.lastX,
      clientY: press.lastY,
    })
  }, 350)
}
function cancelCaptionPress() {
  clearTimeout(captionPress.value?.timer)
  captionPress.value = null
}
async function fusionAttachTask(_event, taskId) {
  const item = windows.value[0]
  if (!isFusionApp || !item || !Number.isInteger(taskId))
    return
  if (item.ready)
    await window.$preload.ipcRenderer.invoke('desktop-notification-attach', { packageName: item.packageName, taskId }).catch(error => notify(error.message))
  else item.pendingFusionTaskId = taskId
}
async function setFusionInput(key, value) {
  const item = windows.value[0]
  if (!item || !['mouse', 'keyboard'].includes(key) || !['', 'sdk', 'uhid', 'disabled'].includes(value))
    return
  const previous = item.config[key]
  item.config[key] = value
  await window.$preload.ipcRenderer.invoke('desktop-app-close', item.id)
  item.ready = false
  await startApp(item)
  if (!item.ready) {
    item.config[key] = previous
    return
  }
  preferences.appConfigs[item.packageName] = { ...item.config }
  savePreferences()
}
async function resolvePreferenceIdentity() {
  const identity = await window.$preload.ipcRenderer.invoke('desktop-device-identity', deviceId).catch(() => null)
  if (typeof identity?.key !== 'string' || !identity.key)
    return
  const all = window.$preload.store.get('androidDesktop') || {}
  const canonical = all[identity.key]
  const transport = all[deviceId] || {}
  const preferred = canonical?.identityVersion ? canonical : { ...canonical, ...transport }
  if (preferred) {
    Object.assign(preferences, preferred)
    for (const field of ['appConfigs', 'appWindows', 'appUsage']) {
      preferences[field] = { ...transport[field], ...canonical?.[field], ...preferred[field] }
    }
  }
  preferenceKey.value = identity.key
  preferences.identityVersion = 1
  if (preferences.wallpaperSource === 'phone')
    preferences.wallpaperSource = 'phone-live'
  savePreferences()
}
function persistWindows() {
  for (const item of windows.value) rememberWindow(item)
}
function captureWindowBounds(item) {
  item.preferredBounds = { x: item.x, y: item.y, width: item.width, height: item.height }
  item.orientationBounds ||= {}
  item.orientationBounds[appRatio(item) > 1 ? 'landscape' : 'portrait'] = { ...item.preferredBounds }
}
function rememberWindow(item) {
  if (isFusionApp)
    return
  preferences.appWindows ||= {}
  preferences.appWindows[item.packageName] = {
    ...(item.preferredBounds || { x: item.x, y: item.y, width: item.width, height: item.height }),
    orientationBounds: item.orientationBounds || {},
    orientation: appRatio(item) > 1 ? 'landscape' : 'portrait',
    maximized: item.maximized,
    fullscreen: fullscreenId.value === item.id,
    updatedAt: Date.now(),
  }
  savePreferences()
}
function restoreWindow(item) {
  const record = preferences.appWindows?.[item.packageName]
  if (!record) {
    captureWindowBounds(item)
    return
  }
  item.orientationBounds = { ...record.orientationBounds }
  const orientation = appRatio(item) > 1 ? 'landscape' : 'portrait'
  const saved = item.orientationBounds[orientation] || (record.orientation && record.orientation !== orientation ? { ...record, width: record.height, height: record.width } : record)
  item.preferredBounds = { x: saved.x, y: saved.y, width: saved.width, height: saved.height }
  const area = workSize()
  if (Number.isFinite(saved.width) && saved.width >= 120)
    item.width = Math.min(saved.width, area.width)
  if (Number.isFinite(saved.height) && saved.height >= 160)
    item.height = Math.min(saved.height, area.height)
  if (resizeMode === 'aspect')
    fitAppWindow(item, item.width)
  item.x = Math.max(
    0,
    Math.min(
      Number.isFinite(saved.x) ? saved.x : item.x,
      area.width - item.width,
    ),
  )
  item.y = Math.max(
    0,
    Math.min(
      Number.isFinite(saved.y) ? saved.y : item.y,
      area.height - item.height,
    ),
  )
  item.maximized = Boolean(saved.maximized)
}
function savePreferences() {
  const all = window.$preload.store.get('androidDesktop') || {}
  const latest = all[preferenceKey.value] || {}
  let next = JSON.parse(JSON.stringify(preferences))
  if (isFusionApp) {
    const pkg = window.$preload.payload.fusionApp.packageName
    next = { ...latest }
    for (const field of ['appConfigs', 'appUsage']) next[field] = { ...latest[field], ...(preferences[field]?.[pkg] ? { [pkg]: preferences[field][pkg] } : {}) }
  }
  else if (isFusionLauncher) {
    next = { ...latest, appUsage: { ...latest.appUsage, ...next.appUsage } }
  }
  window.$preload.store.set('androidDesktop', {
    ...all,
    [preferenceKey.value]: JSON.parse(JSON.stringify(next)),
  })
}
function workSize() {
  return {
    width: desktopEl.value?.clientWidth || 1280,
    height: (desktopEl.value?.clientHeight || 800) - (isFusionApp ? 0 : 56),
  }
}
function isWindowVisible(item) {
  const base = windows.value.find(entry => entry.id === fullscreenId.value)
  return !item.minimized && (!base || item.id === base.id || item.z > base.z)
}
function fitAppWindow(item, wantedWidth = item.width) {
  const area = workSize()
  const ratio = appRatio(item)
  const width = Math.min(
    wantedWidth,
    area.width,
    area.height * ratio,
  )
  item.width = width
  item.height = width / ratio
  item.x = Math.max(0, Math.min(item.x, area.width - item.width))
  item.y = Math.max(0, Math.min(item.y, area.height - item.height))
}
async function toggleHostFullscreen() {
  hostFullscreen.value = await window.$preload.ipcRenderer.invoke(
    'desktop-host-action',
    'fullscreen',
  )
  nextTick(reflowWindows)
}
function snapPixel(value) {
  const scale = window.devicePixelRatio || 1
  return Math.round(value * scale) / scale
}
function captionStyle(item) {
  if (isFusionApp)
    return { left: '0px', top: '0px', width: '100%', height: '32px', transform: 'none' }
  if (item.config.captionPinned || captionId.value === item.id || resolutionId.value === item.id)
    return {}
  const scale = window.devicePixelRatio || 1
  const width = Math.round(48 * scale / 2) * 2 / scale
  const height = Math.round(18 * scale / 2) * 2 / scale
  return { left: `${snapPixel(item.x + (item.width - width) / 2) - snapPixel(item.x)}px`, top: `${snapPixel(item.y + 8) - snapPixel(item.y)}px`, width: `${width}px`, height: `${height}px`, transform: 'none' }
}
function windowStyle(item) {
  if (isFusionApp)
    return { left: '0px', top: '0px', width: '100%', height: '100%' }
  if (fullscreenId.value === item.id) {
    return {
      zIndex: 10000,
      left: '0px',
      top: '0px',
      width: '100%',
      height: '100%',
    }
  }
  const area = workSize()
  if (item.maximized && resizeMode === 'aspect') {
    const ratio = appRatio(item)
    const width = Math.min(area.width, area.height * ratio)
    return {
      zIndex: fullscreenId.value ? 10000 + item.z : item.z,
      left: `${(area.width - width) / 2}px`,
      top: '0px',
      width: `${width}px`,
      height: `${width / ratio}px`,
    }
  }
  if (item.maximized) {
    return {
      zIndex: fullscreenId.value ? 10000 + item.z : item.z,
      left: '0px',
      top: '0px',
      width: `${area.width}px`,
      height: `${area.height}px`,
    }
  }
  return {
    zIndex: fullscreenId.value ? 10000 + item.z : item.z,
    left: `${snapPixel(item.x)}px`,
    top: `${snapPixel(item.y)}px`,
    width: `${snapPixel(item.width)}px`,
    height: `${snapPixel(item.height)}px`,
  }
}
function reflowWindows() {
  if (!desktopEl.value)
    return
  const area = workSize()
  for (const item of windows.value) {
    if (gesture?.id !== item.id && item.preferredBounds)
      Object.assign(item, item.preferredBounds)
    if (!item.config?.width || !item.config?.height)
      continue
    if (resizeMode === 'aspect') {
      fitAppWindow(item, Math.min(item.width, area.width))
    }
    else {
      item.width = Math.max(120, Math.min(item.width, area.width))
      item.height = Math.max(160, Math.min(item.height, area.height))
    }
    item.x = Math.max(0, Math.min(item.x, area.width - item.width))
    item.y = Math.max(0, Math.min(item.y, area.height - item.height))
  }
  queueLayout()
}
function dismissOutside(event) {
  const target = event.target
  if (target.closest('.fusion-app-settings, .fusion-settings-toggle, .fusion-start-button'))
    return
  fusionSettingsOpen.value = false
  if (
    resolutionId.value
    && target.closest('.app-window')?.dataset.appId === resolutionId.value
    && target.closest('.app-titlebar, .resize-handle')
  ) {
    return
  }
  if (
    target.closest(
      '.start-menu, .quick-settings, .notification-panel, .personalization, .resolution-panel, .fullscreen-float, .start-button, .tray-controls, .tray-clock, .task-context-menu, .app-titlebar, .desktop-shortcut, .notification-banner',
    )
  ) {
    return
  }
  if (
    drawerOpen.value
    || panel.value
    || resolutionId.value
    || floatOpen.value
    || taskMenu.value
    || captionId.value
    || launcherMenu.value
  ) {
    closeOverlays()
  }
}
function dismissNative(_event, appId) {
  // Foreground activation can briefly blur the Electron host while it moves
  // focus from the embedded child. Keep editors alive during that handoff.
  if (!appId && (resolutionId.value || fusionSettingsOpen.value || isDesktopEditor(document.activeElement)))
    return
  hostInputActive.value = false
  if (isDesktopEditor(document.activeElement))
    document.activeElement.blur()
  closeOverlays()
}
async function clearNotifications() {
  if (notificationBusy.value)
    return
  notificationBusy.value = 'clear'
  notificationRequest++
  try {
    await window.$preload.ipcRenderer.invoke('desktop-notification-action', {
      deviceId,
      action: 'clear',
    })
    await readNotifications()
  }
  catch (error) {
    notify(error.message)
  }
  finally {
    notificationBusy.value = ''
  }
}
async function dismissNotification(notice) {
  if (notificationBusy.value)
    return
  notificationBusy.value = notice.key
  notificationRequest++
  try {
    await window.$preload.ipcRenderer.invoke('desktop-notification-action', {
      deviceId,
      action: 'dismiss',
      key: notice.key,
    })
    await readNotifications()
  }
  catch (error) {
    notify(error.message)
  }
  finally {
    notificationBusy.value = ''
  }
}
async function openNotification(notice) {
  if (notificationBusy.value)
    return
  notificationBusy.value = notice.key
  try {
    const result = await window.$preload.ipcRenderer.invoke(
      'desktop-notification-action',
      { deviceId, action: 'open', key: notice.key },
    )
    const packageName = result.packageName || notice.packageName
    await launch(
      apps.value.find(app => app.packageName === packageName) || {
        packageName,
        name: notice.appName,
        icon: notice.icon,
      },
    )
    if (result.taskId > 0) {
      await window.$preload.ipcRenderer
        .invoke('desktop-notification-attach', {
          packageName,
          taskId: result.taskId,
        })
        .catch(() => false)
    }
    await readNotifications()
  }
  catch (error) {
    notify(error.message)
  }
  finally {
    notificationBusy.value = ''
  }
}
function pauseBanner(id) {
  clearTimeout(bannerTimers.get(id))
  bannerTimers.delete(id)
}
function resumeBanner(id) {
  pauseBanner(id)
  bannerTimers.set(
    id,
    setTimeout(() => dismissBanner(id), 5000),
  )
}
function dismissBanner(id) {
  pauseBanner(id)
  notificationBanners.value = notificationBanners.value.filter(
    banner => banner.id !== id,
  )
  queueLayout()
}
function addBanner(notice) {
  if (notificationBanners.value.length >= 3)
    dismissBanner(notificationBanners.value[0].id)
  const id = ++bannerSequence
  notificationBanners.value.push({ id, notice })
  resumeBanner(id)
  queueLayout()
}
function focusApp(item, event) {
  if (hostInputActive.value || drawerOpen.value || panel.value || resolutionId.value || isDesktopEditor(document.activeElement))
    return
  if (event?.target?.closest('.app-titlebar, .resize-handle'))
    return
  if (resolutionId.value === item.id)
    return
  if (
    !item.ready
    || item.minimized
    || gesture
    || event?.target?.closest('button, input, select')
  ) {
    return
  }
  window.$preload.ipcRenderer
    .invoke('desktop-app-focus', item.id)
    .catch(error => notify(error.message))
}
function phoneError(error) {
  const message = error?.message || String(error)
  if (
    /device .*not found|device offline|no devices|disconnected|cannot connect|closed/i.test(
      message,
    )
  ) {
    connectionLost.value = true
    notify('手机连接暂时中断，正在等待恢复连接')
  }
  else {
    notify(`操作失败：${message}`)
  }
}
function activate(item) {
  if (activeId.value === item.id && !item.minimized)
    return
  activeId.value = item.id
  item.minimized = false
  item.z = ++zOrder
  queueLayout()
}
function closeOverlays() {
  fusionSettingsOpen.value = false
  captionId.value = ''
  taskMenu.value = null
  launcherMenu.value = null
  drawerOpen.value = false
  panel.value = ''
  resolutionId.value = ''
  floatOpen.value = false
  queueLayout()
}
function toggleDrawer() {
  taskMenu.value = null
  drawerOpen.value = !drawerOpen.value
  panel.value = ''
  resolutionId.value = ''
  if (drawerOpen.value && !apps.value.length)
    loadApps()
  queueLayout()
}
function openPanel(name) {
  taskMenu.value = null
  panel.value = panel.value === name ? '' : name
  drawerOpen.value = false
  resolutionId.value = ''
  floatOpen.value = false
  if (panel.value === 'notifications')
    readNotifications()

  queueLayout()
}
function taskClick(item) {
  reflowWindows()
  closeOverlays()
  if (activeId.value === item.id && !item.minimized) {
    minimize(item)
  }
  else {
    activate(item)
    focusApp(item)
  }
}
function minimize(item) {
  if (isFusionApp) {
    window.$preload.ipcRenderer.invoke('desktop-host-action', 'minimize')
    return
  }
  item.minimized = true
  if (fullscreenId.value === item.id)
    fullscreenId.value = ''
  activeId.value = ''
  queueLayout()
}
function showDesktop() {
  for (const item of windows.value) item.minimized = true
  activeId.value = ''
  closeOverlays()
  queueLayout()
}
function toggleMaximize(item) {
  item.maximized = !item.maximized
  rememberWindow(item)
  activate(item)
  queueLayout()
  if (resizeMode === 'adaptive')
    nextTick(() => syncWindowResolution(item))
}
function enterFullscreen(item) {
  if (isFusionApp) {
    window.$preload.ipcRenderer.invoke('desktop-host-action', 'fullscreen').then((value) => {
      hostFullscreen.value = Boolean(value)
      queueLayout()
    }).catch(error => notify(error.message))
    return
  }
  const previous = windows.value.find(
    entry => entry.id === fullscreenId.value,
  )
  fullscreenId.value = item.id
  if (previous && previous.id !== item.id)
    rememberWindow(previous)
  rememberWindow(item)
  item.minimized = false
  activeId.value = item.id
  item.z = ++zOrder
  closeOverlays()
  queueLayout()
}
function exitFullscreen() {
  if (fusionFullscreen.value) {
    window.$preload.ipcRenderer.invoke('desktop-host-action', 'fullscreen').then((value) => {
      hostFullscreen.value = Boolean(value)
      queueLayout()
    }).catch(error => notify(error.message))
    closeOverlays()
    return
  }
  const item = windows.value.find(entry => entry.id === fullscreenId.value)
  fullscreenId.value = ''
  if (item)
    rememberWindow(item)
  floatOpen.value = false
  closeOverlays()
  reflowWindows()
}

async function loadApps(force = false) {
  if (appsLoading.value || !connected.value || (!force && apps.value.length))
    return
  appsLoading.value = true
  try {
    const result = await window.$preload.ipcRenderer.invoke(
      'desktop-catalog',
      deviceId,
    )
    apps.value = (result || []).sort((a, b) =>
      a.name.localeCompare(b.name, 'zh-CN'),
    )
    if (!apps.value.length)
      throw new Error('手机未返回可启动的应用')
  }
  catch (error) {
    notify(`读取图标失败：${error.message}`)
    if (!apps.value.length) {
      apps.value = await window.$preload.scrcpy
        .getAppList(deviceId)
        .catch(() => [])
    }
  }
  finally {
    appsLoading.value = false
  }
}

const pendingLaunches = new Set()
async function resolveLaunchConfig(app) {
  const saved = preferences.appConfigs[app.packageName] || {}
  const explicit
    = saved.layout !== 'device'
      && [saved.width, saved.height, saved.dpi].every(
        value => Number.isFinite(value) && value > 0,
      )
  const dimensions = explicit
    ? { width: saved.width, height: saved.height, dpi: saved.dpi }
    : await window.$preload.ipcRenderer.invoke(
        'desktop-device-layout',
        deviceId,
      )
  return {
    rightBack: false,
    lockLogical: false,
    ...saved,
    ...dimensions,
    layout: explicit
      ? saved.layout
      || (dimensions.width < dimensions.height ? 'phone' : 'tablet')
      : 'device',
  }
}
async function launch(app, options = {}) {
  if (app.mirror) {
    if (!connected.value)
      return notify('请先连接手机')
    closeOverlays()
    try {
      await window.$preload.ipcRenderer.invoke('desktop-phone-mirror', deviceId)
    }
    catch (error) { notify(error.message) }
    return
  }
  if (!connected.value)
    return notify('请先连接手机')
  if (isFusion && !options.fusionLocal) {
    closeOverlays()
    await window.$preload.win.open('pages/desktop', { device: { ...(device.value || window.$preload.payload.device), id: deviceId }, fusionRole: 'app', fusionApp: { packageName: app.packageName, name: app.name, icon: app.icon }, fusionTaskId: options.taskId, instanceId: `fusion-app:${deviceId}:${app.packageName}` })
    return
  }
  preferences.appUsage ||= {}
  const usage = preferences.appUsage[app.packageName] || { count: 0 }
  preferences.appUsage[app.packageName] = {
    count: usage.count + 1,
    lastUsed: Date.now(),
  }
  savePreferences()
  const existing = windows.value.find(
    item => item.packageName === app.packageName,
  )
  const keepControl = options.fromControl && panel.value === 'control'
  if (!keepControl)
    closeOverlays()
  if (existing) {
    reflowWindows()
    activate(existing)
    nextTick(() => focusApp(existing))
    if (!existing.ready && !existing.starting)
      await startApp(existing)
    if (options.taskId && existing.ready)
      await window.$preload.ipcRenderer.invoke('desktop-notification-attach', { packageName: app.packageName, taskId: options.taskId })
    return
  }
  if (pendingLaunches.has(app.packageName))
    return
  pendingLaunches.add(app.packageName)
  try {
    const config = await resolveLaunchConfig(app)
    const area = workSize()
    const width = Math.min(
      config.width < config.height ? 420 : 880,
      area.width - 40,
      ((area.height - 98) * config.width) / config.height,
    )
    const height = Math.round((width * config.height) / config.width)
    const offset = (windows.value.length % 7) * 28
    const item = reactive({
      ...app,
      id: app.packageName,
      taskId: options.taskId,
      config,
      rightBack: Boolean(config.rightBack),
      rightBusy: false,
      x: Math.max(16, (area.width - width) / 2 + offset - 60),
      y: Math.min(50 + offset, area.height - height - 16),
      width,
      height,
      z: ++zOrder,
      ready: false,
      starting: false,
      minimized: false,
      maximized: false,
      error: '',
    })
    restoreWindow(item)
    windows.value.push(item)
    activeId.value = item.id
    if (isFusionApp)
      await window.$preload.ipcRenderer.invoke('desktop-fusion-app-layout', config.width / config.height)
    await startApp(item)
    if (!isFusion && item.ready && preferences.appWindows?.[item.packageName]?.fullscreen)
      enterFullscreen(item)
  }
  catch (error) {
    notify(`无法读取应用的启动分辨率：${error.message}`)
  }
  finally {
    pendingLaunches.delete(app.packageName)
  }
}

async function startApp(item) {
  if (item.starting || !connected.value)
    return
  item.starting = true
  item.error = ''
  item.suspended = false
  try {
    const result = await window.$preload.ipcRenderer.invoke(
      'desktop-app-open',
      {
        deviceId,
        id: item.id,
        packageName: item.packageName,
        config: { ...item.config },
        rightBack: item.rightBack,
        taskId: item.taskId,
      },
    )
    if (!windows.value.includes(item))
      return
    item.config = {
      ...item.config,
      width: result.width,
      height: result.height,
      dpi: result.dpi,
    }
    item.taskId = null
    if (result.frameSize)
      applyFrameSize(item, result.frameSize)
    item.rightBack = result.rightBack ?? item.rightBack
    item.config.rightBack = item.rightBack
    if (isFusionApp)
      await window.$preload.ipcRenderer.invoke('desktop-fusion-app-layout', item.config.width / item.config.height)
    if (resizeMode === 'aspect')
      fitAppWindow(item, item.width)
    item.ready = true
    if (isFusionApp && item.pendingFusionTaskId) {
      await fusionAttachTask(null, item.pendingFusionTaskId)
      item.pendingFusionTaskId = null
    }
    queueLayout()
    if (activeId.value === item.id)
      nextTick(() => focusApp(item))
  }
  catch (error) {
    item.error = error.message
    item.ready = false
    notify(`无法打开 ${item.name}：${error.message}`)
  }
  finally {
    item.starting = false
  }
}

async function closeApp(item) {
  if (isFusionApp) {
    rememberWindow(item)
    await window.$preload.ipcRenderer.invoke('desktop-host-action', 'close')
    return
  }
  rememberWindow(item)
  if (activeId.value === item.id)
    activeId.value = ''
  if (captionPress.value?.id === item.id)
    cancelCaptionPress()
  if (captionId.value === item.id)
    captionId.value = ''
  if (fullscreenId.value === item.id)
    fullscreenId.value = ''
  if (resolutionId.value === item.id)
    resolutionId.value = ''
  windows.value = windows.value.filter(
    windowItem => windowItem.id !== item.id,
  )
  await window.$preload.ipcRenderer
    .invoke('desktop-app-close', item.id)
    .catch(() => {})
  queueLayout()
}

function toggleCaptionPin(item) {
  if (isFusionApp)
    fusionCaptionHidden.value = false
  item.config.captionPinned = !item.config.captionPinned
  preferences.appConfigs[item.packageName] = { ...item.config }
  savePreferences()
  queueLayout()
}
async function toggleRightButton(item) {
  if (!item.ready || item.rightBusy)
    return
  item.rightBusy = true
  try {
    item.rightBack = await window.$preload.ipcRenderer.invoke(
      'desktop-app-right-button',
      { id: item.id, enabled: !item.rightBack },
    )
    item.config.rightBack = item.rightBack
    preferences.appConfigs[item.packageName] = { ...item.config }
    savePreferences()
  }
  catch (error) {
    notify(error.message)
  }
  finally {
    item.rightBusy = false
  }
}

function rect(element) {
  const r = element.getBoundingClientRect()
  return {
    x: r.x,
    y: r.y,
    width: r.width,
    height: r.height,
    radius: Math.min(
      r.width / 2,
      r.height / 2,
      Number.parseFloat(getComputedStyle(element).borderTopLeftRadius) || 0,
    ),
  }
}
let panelAnimationFrame = 0
let panelAnimationUntil = 0
function animatePanels() {
  panelAnimationUntil = Date.now() + 240
  if (panelAnimationFrame)
    return
  const tickLayout = () => {
    queueLayout()
    panelAnimationFrame
      = Date.now() < panelAnimationUntil ? requestAnimationFrame(tickLayout) : 0
  }
  panelAnimationFrame = requestAnimationFrame(tickLayout)
}
function queueLayout() {
  if (layoutFrame)
    return
  nextTick(() => {
    if (layoutFrame)
      return
    layoutFrame = requestAnimationFrame(() => {
      layoutFrame = 0
      const sorted = [...windows.value].sort((a, b) => a.z - b.z)
      const overlays = [
        ...(desktopEl.value?.querySelectorAll('[data-native-overlay]') || []),
      ]
        .filter(element => !element.closest('.app-window'))
        .map(rect)
      const layout = sorted.map((item, index) => {
        const element = views.get(item.id)
        const visible = item.ready && !item.minimized && isWindowVisible(item)
        const bounds = element
          ? rect(element)
          : { x: 0, y: 0, width: 0, height: 0 }
        const clips = sorted
          .slice(index + 1)
          .filter(other => !other.minimized && isWindowVisible(other))
          .map(other => shells.get(other.id))
          .filter(Boolean)
          .map(rect)
        return {
          id: item.id,
          ...bounds,
          radius: isFusionApp || fullscreenId.value === item.id || item.maximized ? 0 : 16,
          visible,
          clips: [
            ...clips,
            ...overlays,
            ...[
              ...(shells.get(item.id)?.querySelectorAll('.app-titlebar, .resize-handle') || []),
            ].map(rect),
          ],
        }
      })
      window.$preload.ipcRenderer.send('desktop-app-layout', layout)
    })
  })
}

function captureGesture(event, item, edges) {
  if (event.button !== 0 || fullscreenId.value === item.id)
    return
  event.preventDefault()
  activate(item)
  const resolutionOwner = resolutionId.value
  const captionOwner = captionId.value
  closeOverlays()
  captionId.value = captionOwner
  if (resolutionOwner === item.id)
    resolutionId.value = resolutionOwner
  if (item.maximized)
    return
  event.currentTarget.setPointerCapture(event.pointerId)
  gesture = {
    id: item.id,
    edges,
    pointerId: event.pointerId,
    x: event.clientX,
    y: event.clientY,
    initial: { x: item.x, y: item.y, width: item.width, height: item.height },
  }
}
function beginResize(event, item, edges) {
  if (isFusionApp) {
    if (fusionFullscreen.value)
      return
    event.currentTarget.setPointerCapture(event.pointerId)
    window.$preload.ipcRenderer.invoke('desktop-host-action', `resize:${edges}`)
    return
  }
  captureGesture(event, item, edges)
}
function pointerMove(event) {
  const shortcut = shortcutPress.value
  if (shortcut && shortcut.pointerId === event.pointerId) {
    shortcut.lastX = event.clientX
    shortcut.lastY = event.clientY
    if (shortcut.dragging) {
      shortcut.app.x = Math.max(
        4,
        Math.min(
          innerWidth - 92,
          shortcut.initialX + event.clientX - shortcut.x,
        ),
      )
      shortcut.app.y = Math.max(
        52,
        Math.min(
          innerHeight - 150,
          shortcut.initialY + event.clientY - shortcut.y,
        ),
      )
    }
  }
  const press = captionPress.value
  if (press && press.pointerId === event.pointerId) {
    press.lastX = event.clientX
    press.lastY = event.clientY
  }
  if (!gesture || gesture.pointerId !== event.pointerId)
    return
  const item = windows.value.find(entry => entry.id === gesture.id)
  if (!item)
    return
  const area = workSize()
  const dx = event.clientX - gesture.x
  const dy = event.clientY - gesture.y
  const initial = gesture.initial
  if (!gesture.edges) {
    item.x = Math.max(
      -item.width + 180,
      Math.min(area.width - 180, initial.x + dx),
    )
    item.y = Math.max(0, Math.min(area.height - item.height, initial.y + dy))
  }
  else if (resizeMode === 'aspect') {
    const ratio = appRatio(item)
    const horizontal = gesture.edges.includes('e')
      ? dx
      : gesture.edges.includes('w')
        ? -dx
        : 0
    const vertical = gesture.edges.includes('s')
      ? dy
      : gesture.edges.includes('n')
        ? -dy
        : 0
    const change
      = Math.abs(horizontal) >= Math.abs(vertical * ratio)
        ? horizontal
        : vertical * ratio
    const right = initial.x + initial.width
    const bottom = initial.y + initial.height
    const maxWidth = gesture.edges.includes('w')
      ? right
      : area.width - initial.x
    const maxHeight = gesture.edges.includes('n')
      ? bottom
      : area.height - initial.y
    item.width = Math.max(
      120,
      Math.min(maxWidth, maxHeight * ratio, initial.width + change),
    )
    item.height = item.width / ratio
    if (gesture.edges.includes('w'))
      item.x = right - item.width
    if (gesture.edges.includes('n'))
      item.y = bottom - item.height
  }
  else {
    const right = initial.x + initial.width
    const bottom = initial.y + initial.height
    if (gesture.edges.includes('e')) {
      item.width = Math.max(
        320,
        Math.min(area.width - initial.x, initial.width + dx),
      )
    }
    if (gesture.edges.includes('s')) {
      item.height = Math.max(
        240,
        Math.min(area.height - initial.y, initial.height + dy),
      )
    }
    if (gesture.edges.includes('w')) {
      item.x = Math.max(0, Math.min(right - 320, initial.x + dx))
      item.width = right - item.x
    }
    if (gesture.edges.includes('n')) {
      item.y = Math.max(0, Math.min(bottom - 240, initial.y + dy))
      item.height = bottom - item.y
    }
  }
  queueLayout()
}
function pointerUp(event) {
  if (isFusionApp)
    window.$preload.ipcRenderer.invoke('desktop-host-action', 'drag-end')
  const shortcut = shortcutPress.value
  if (shortcut && (!event || event.pointerId === shortcut.pointerId)) {
    clearTimeout(shortcut.timer)
    if (shortcut.dragging) {
      savePreferences()
    }
    else if (
      event?.type !== 'pointercancel'
      && Math.hypot(shortcut.lastX - shortcut.x, shortcut.lastY - shortcut.y) < 8
    ) {
      launch(shortcut.app)
    }
    shortcutPress.value = null
  }
  const press = captionPress.value
  if (press && (!event || event.pointerId === press.pointerId)) {
    const item = windows.value.find(entry => entry.id === press.id)
    if (
      item
      && !press.dragging
      && event?.type !== 'pointercancel'
      && Math.hypot(press.lastX - press.x, press.lastY - press.y) < 8
    ) {
      toggleCaption(item)
    }
    cancelCaptionPress()
  }
  for (const change of Object.values(levelChanges)) change.editing = false
  const item
    = gesture && windows.value.find(entry => entry.id === gesture.id)
  if (item && gesture.edges && resizeMode === 'adaptive')
    syncWindowResolution(item)
  if (item) {
    captureWindowBounds(item)
    rememberWindow(item)
  }
  gesture = null
  queueLayout()
}

async function syncWindowResolution(item) {
  if (!item.ready)
    return
  const area = views.get(item.id)?.getBoundingClientRect()
  if (!area)
    return
  const scale = item.config.dpi / 160
  const config = {
    ...item.config,
    width: Math.max(320, Math.min(3840, Math.round(area.width * scale))),
    height: Math.max(320, Math.min(3840, Math.round(area.height * scale))),
    layout: 'adaptive',
  }
  try {
    const result = await window.$preload.ipcRenderer.invoke(
      'desktop-app-resolution',
      { id: item.id, config },
    )
    item.config = { ...config, ...result }
    preferences.appConfigs[item.packageName] = { ...item.config }
    savePreferences()
  }
  catch (error) {
    notify(`此应用暂时不支持重新排版：${error.message}`)
  }
}
function editResolution(item) {
  resolutionId.value = item.id
  panel.value = ''
  drawerOpen.value = false
  resolutionError.value = ''
  Object.assign(resolutionForm, {
    layout: 'device',
    lockLogical: true,
    ...item.config,
  })
  queueLayout()
}
function matchDensity() {
  if (resolutionForm.layout === 'device') {
    resolutionForm.layout
      = resolutionForm.width < resolutionForm.height ? 'phone' : 'tablet'
  }
  if (resolutionForm.lockLogical) {
    resolutionForm.dpi = Math.max(
      100,
      Math.min(
        640,
        Math.round(
          (Math.min(resolutionForm.width, resolutionForm.height) * 160)
          / (resolutionForm.layout === 'tablet' ? 720 : 411),
        ),
      ),
    )
  }
}
async function changeLayout() {
  if (resolutionForm.layout === 'device') {
    try {
      const spec = await window.$preload.ipcRenderer.invoke(
        'desktop-device-layout',
        deviceId,
      )
      Object.assign(resolutionForm, spec, {
        layout: 'device',
        lockLogical: false,
      })
    }
    catch (error) {
      resolutionError.value = error.message
    }
    return
  }
  const tabletLayout = resolutionForm.layout === 'tablet'
  const landscape = resolutionForm.width >= resolutionForm.height
  if (tabletLayout !== landscape) {
    [resolutionForm.width, resolutionForm.height] = [
      resolutionForm.height,
      resolutionForm.width,
    ]
  }
  resolutionForm.lockLogical = true
  matchDensity()
}
function selectResolution(index) {
  const preset = presets[Number(index)]
  if (!preset)
    return
  Object.assign(resolutionForm, {
    width: preset.width,
    height: preset.height,
    layout: preset.width < preset.height ? 'phone' : 'tablet',
    lockLogical: true,
  })
  matchDensity()
}
async function applyResolution(restart) {
  const item = resolutionApp.value
  if (!item)
    return
  resolutionBusy.value = true
  resolutionError.value = ''
  const config = { ...resolutionForm, rightBack: item.rightBack }
  try {
    if (restart) {
      if (
        ![config.width, config.height, config.dpi].every(Number.isFinite)
        || Math.min(config.width, config.height) < 320
        || Math.max(config.width, config.height) > 3840
        || config.dpi < 100
        || config.dpi > 640
      ) {
        throw new Error('请检查分辨率与 DPI 范围')
      }
      await window.$preload.ipcRenderer.invoke('desktop-app-close', item.id)
      item.ready = false
      item.config = config
      await startApp(item)
      if (!item.ready)
        throw new Error(item.error)
    }
    else {
      const result = await window.$preload.ipcRenderer.invoke(
        'desktop-app-resolution',
        { id: item.id, config },
      )
      item.config = { ...config, ...result }
    }
    preferences.appConfigs[item.packageName] = { ...item.config }
    if (resizeMode === 'aspect')
      fitAppWindow(item)
    rememberWindow(item)
    savePreferences()
    resolutionId.value = ''
    notify('已更新这个应用的分辨率与 DPI')
  }
  catch (error) {
    resolutionError.value = `${error.message}。可以保存并重新打开应用，应用可能重新加载。`
  }
  finally {
    resolutionBusy.value = false
    queueLayout()
  }
}

async function stopLiveWallpaper() {
  if (!liveWallpaper.value)
    return
  liveWallpaper.value = false
  liveWallpaperFrame.value = ''
  await window.$preload.ipcRenderer
    .invoke('desktop-wallpaper-stop')
    .catch(() => {})
}
async function pickWallpaper() {
  try {
    const image = await window.$preload.ipcRenderer.invoke(
      'desktop-wallpaper-pick',
    )
    if (image) {
      await stopLiveWallpaper()
      preferences.wallpaperImage = image
      preferences.wallpaperSource = 'local'
      wallpaperError.value = ''
      savePreferences()
    }
  }
  catch (error) {
    wallpaperError.value = error.message
  }
}
async function changeWallpaperSource(source) {
  if (source === 'local')
    return pickWallpaper()
  if (source === 'phone-static' || source === 'phone-live')
    return syncPhoneWallpaper(true, source)
  await stopLiveWallpaper()
  preferences.wallpaperSource = source
  savePreferences()
}
async function syncPhoneWallpaper(
  manual = false,
  source = preferences.wallpaperSource.startsWith('phone-')
    ? preferences.wallpaperSource
    : 'phone-static',
) {
  if (wallpaperBusy.value || !connected.value) {
    if (manual && !connected.value)
      wallpaperError.value = '请先连接手机'
    return
  }
  wallpaperBusy.value = true
  try {
    const result = await window.$preload.ipcRenderer.invoke(
      'desktop-wallpaper-follow',
      {
        deviceId,
        fit: preferences.wallpaperFit,
        mode: source === 'phone-live' ? 'live' : 'static',
      },
    )
    liveWallpaper.value = result.live
    if (!result.live)
      liveWallpaperFrame.value = ''
    const image = result.image || preferences.wallpaperImage
    queueLayout()
    if (
      image !== preferences.wallpaperImage
      || preferences.wallpaperSource !== source
    ) {
      preferences.wallpaperImage = image
      preferences.wallpaperSource = source
      savePreferences()
    }
    wallpaperError.value = ''
  }
  catch (error) {
    wallpaperError.value = error.message
  }
  finally {
    wallpaperBusy.value = false
  }
}

async function runShell(command) {
  if (!connected.value)
    throw new Error('手机未连接')
  const output = await window.$preload.ipcRenderer.invoke(
    'desktop-phone-command',
    { deviceId, command },
  )
  if (
    /Exception|Permission denial|Error:|Unknown command|not found|failed/i.test(
      output,
    )
  ) {
    throw new Error(output.trim().slice(0, 200))
  }
  return output
}
async function readState() {
  if (device.value?.status !== 'device')
    return
  const revisions = Object.fromEntries(
    Object.entries(levelChanges).map(([kind, change]) => [
      kind,
      change.revision,
    ]),
  )
  try {
    const state = await window.$preload.ipcRenderer.invoke(
      'desktop-device-state',
      deviceId,
    )
    for (const [key, value] of Object.entries(state)) {
      const change = levelChanges[key]
      if (
        !change
        || (!change.editing
          && !change.running
          && !change.pending
          && revisions[key] === change.revision)
      ) {
        phoneState[key] = value
      }
    }
  }
  catch (error) {
    phoneError(error)
  }
}
async function toggleControl(key) {
  if (key === 'settings') {
    return launch(
      apps.value.find(
        item => item.packageName === 'com.android.settings',
      ) || { name: '设置', packageName: 'com.android.settings' },
    )
  }
  if (controlBusy.value)
    return
  controlBusy.value = true
  ++controlRevision
  const enabled = !phoneState[key]
  try {
    Object.assign(
      phoneState,
      await window.$preload.ipcRenderer.invoke('desktop-control-action', {
        deviceId,
        key,
        enabled,
      }),
    )
  }
  catch (error) {
    controlError.value = error.message
    phoneError(error)
  }
  finally {
    controlBusy.value = false
  }
}
function queueLevel(kind, value) {
  const change = levelChanges[kind]
  phoneState[kind] = Math.max(
    kind === 'brightness' ? 1 : 0,
    Math.min(100, Number(value)),
  )
  change.pending = { value: phoneState[kind], revision: ++change.revision }
  if (!change.timer) {
    change.timer = setTimeout(() => {
      change.timer = null
      flushLevel(kind)
    }, 80)
  }
}
function setLevel(kind) {
  levelChanges[kind].editing = false
  queueLevel(kind, phoneState[kind])
  return flushLevel(kind)
}
async function flushLevel(kind) {
  const change = levelChanges[kind]
  clearTimeout(change.timer)
  change.timer = null
  if (change.running)
    return
  change.running = true
  try {
    while (change.pending) {
      const request = change.pending
      change.pending = null
      try {
        const state = await window.$preload.ipcRenderer.invoke(
          'desktop-device-level',
          { deviceId, kind, value: request.value },
        )
        if (request.revision === change.revision)
          phoneState[kind] = state[kind]
      }
      catch (error) {
        if (request.revision === change.revision)
          phoneError(error)
      }
    }
  }
  finally {
    change.running = false
  }
}
function toggleMute() {
  if (phoneState.volume) {
    restoreVolume = phoneState.volume
    phoneState.volume = 0
  }
  else {
    phoneState.volume = restoreVolume || 50
  }
  setLevel('volume')
}
async function readNotifications(background = false) {
  if (
    notificationPolling
    || (background && (!connected.value || notificationBusy.value))
  ) {
    return
  }
  const request = ++notificationRequest
  notificationPolling = true
  if (!background)
    notificationsLoading.value = true
  try {
    const notices = await window.$preload.ipcRenderer.invoke(
      'desktop-notifications',
      deviceId,
    )
    if (request !== notificationRequest)
      return
    const next = new Map()
    for (const notice of notices) {
      const fingerprint = `${notice.title}\n${notice.text}`
      if (
        notificationSeeded
        && background
        && panel.value !== 'notifications'
        && knownNotifications.get(notice.key) !== fingerprint
      ) {
        addBanner(notice)
      }
      next.set(notice.key, fingerprint)
    }
    knownNotifications = next
    notificationSeeded = true
    notifications.value = notices
  }
  catch (error) {
    if (!background)
      notify(error.message)
  }
  finally {
    notificationPolling = false
    if (request === notificationRequest)
      notificationsLoading.value = false
  }
}

async function refresh(force = false) {
  if (refreshing || !preferencesReady)
    return
  refreshing = true
  try {
    const health = await window.$preload.ipcRenderer.invoke(
      'desktop-device-connection',
      deviceId,
    )
    const previous = device.value
      || window.$preload.payload?.device || { id: deviceId }
    deviceStore.list = [
      ...deviceStore.list.filter(item => item.id !== deviceId),
      { ...previous, id: deviceId, status: health.status },
    ]
    connectionLost.value = health.status !== 'device'
    if (connected.value) {
      deviceWasConnected = true
      await window.$preload.ipcRenderer.invoke(
        'desktop-device-session',
        deviceId,
      )
      bootProgress.value = 45
      bootStep.value = '读取应用和图标'
      if (!isFusionApp && (force || !apps.value.length))
        await loadApps(force)
      bootProgress.value = 80
      bootStep.value = '初始化桌面控制'
      if (!isFusion)
        await readState()
      if (!isFusion && !notificationSeeded)
        readNotifications(true)
      const battery = await window.$preload.ipcRenderer
        .invoke('desktop-device-battery', deviceId)
        .catch(() => null)
      batteryLevel.value
        = battery && Number.isFinite(Number(battery.level))
          ? Number(battery.level)
          : null
      batteryCharging.value = Boolean(battery?.charging)
      for (const item of windows.value.filter(
        entry =>
          entry.suspended
          && !entry.starting
          && Date.now() >= (entry.nextRetryAt || 0),
      ))
        startApp(item)
      bootProgress.value = 100
      if (isFusionApp && !fusionAppStarted) {
        fusionAppStarted = true
        await launch(window.$preload.payload.fusionApp, { fusionLocal: true, taskId: window.$preload.payload.fusionTaskId })
      }
    }
    else {
      if (deviceWasConnected && health.failures >= 2 && !disconnectClosing) {
        disconnectClosing = true
        persistWindows()
        await window.$preload.ipcRenderer.invoke('desktop-host-action', 'close')
        return
      }
      for (const item of windows.value) {
        item.suspended = true
      }
    }
  }
  catch (error) {
    notify(error.message)
  }
  finally {
    refreshing = false
    initializing.value = false
    queueLayout()
  }
}
function wallpaperFrame(_event, frame) {
  const image = new Image()
  const ack = () =>
    window.$preload.ipcRenderer.send('desktop-wallpaper-ack', frame.sequence)
  image.onload = () => {
    liveWallpaperFrame.value = frame.image
    wallpaperError.value = ''
    ack()
  }
  image.onerror = ack
  image.src = frame.image
}
function wallpaperStatus(_event, message) {
  wallpaperError.value = message
}
function updateWallpaperFit() {
  savePreferences()
  if (preferences.wallpaperSource === 'phone-live')
    syncPhoneWallpaper(true)
}
function tick() {
  const now = new Date()
  clock.value = now.toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
  date.value = `${now.getFullYear()}/${now.getMonth() + 1}/${now.getDate()}`
}
function keydown(event) {
  if (event.key === 'Escape') {
    if (isFusionLauncher) {
      hostAction('minimize')
      return
    }
    if (
      drawerOpen.value
      || panel.value
      || resolutionId.value
      || taskMenu.value
      || captionId.value
      || launcherMenu.value
      || floatOpen.value
    ) {
      closeOverlays()
    }
    else {
      exitFullscreen()
    }
  }
  if (event.ctrlKey && event.code === 'Space') {
    event.preventDefault()
    toggleDrawer()
  }
}
async function externalApp(_event, task) {
  try {
    await launch(apps.value.find(app => app.packageName === task.packageName) || { packageName: task.packageName, name: task.packageName }, { taskId: task.taskId, fromControl: task.fromControl })
  }
  catch (error) { notify(`无法打开应用页面：${error.message}`) }
}
function appRatio(item) {
  return (item.frameSize?.width || item.config.width) / (item.frameSize?.height || item.config.height)
}
function applyFrameSize(item, size) {
  const previousRatio = appRatio(item)
  item.frameSize = size
  const ratio = appRatio(item)
  if (isFusionApp)
    window.$preload.ipcRenderer.invoke('desktop-fusion-app-layout', ratio).catch(error => notify(error.message))
  if ((previousRatio > 1) !== (ratio > 1)) {
    const orientation = ratio > 1 ? 'landscape' : 'portrait'
    const old = item.preferredBounds || item
    item.preferredBounds = item.orientationBounds?.[orientation] || { x: old.x, y: old.y, width: old.height, height: old.width }
    Object.assign(item, item.preferredBounds)
  }
  if (resizeMode === 'aspect')
    fitAppWindow(item, item.width)
}
function frameSizeChanged(_event, size) {
  const item = windows.value.find(item => item.id === size.id)
  if (item)
    applyFrameSize(item, { width: size.width, height: size.height })
  queueLayout()
}
function activated(_event, id) {
  if (hostInputActive.value)
    return
  const item = windows.value.find(entry => entry.id === id)
  if (item && isWindowVisible(item))
    activate(item)
}
function exited(_event, data) {
  const item = windows.value.find(entry => entry.id === data.id)
  if (item) {
    item.ready = false
    item.starting = false
    if (
      data.code !== 0
      && /Device disconnected|connection.*(?:closed|reset)|broken pipe|device .*not found/i.test(
        data.error || '',
      )
      && (item.retryCount || 0) < 3
    ) {
      item.retryCount = (item.retryCount || 0) + 1
      item.suspended = true
      item.nextRetryAt = Date.now() + Math.min(10000, item.retryCount * 2000)
    }
    item.error = connected.value
      ? `应用画面已结束：${(data.error || '点击重新连接').slice(-300)}`
      : '等待手机重新连接'
    queueLayout()
  }
}
function nativeError(_event, message) {
  notify(`桌面窗口：${message}`)
}
watch(
  [
    drawerOpen,
    panel,
    resolutionId,
    floatOpen,
    fullscreenId,
    initializing,
    taskMenu,
    captionId,
    launcherMenu,
    notificationBanners,
  ],
  () => {
    queueLayout()
    window.$preload.ipcRenderer.send(
      'desktop-wallpaper-visible',
      !fullscreenId.value,
    )
  },
)
onMounted(() => {
  tick()
  if (isFusionLauncher)
    drawerOpen.value = true
  window.$preload.ipcRenderer.on('fusion-launcher-blur', fusionBlur)
  window.$preload.ipcRenderer.on('fusion-launcher-open', fusionOpen)
  window.$preload.ipcRenderer.on('desktop-host-fullscreen', hostFullscreenChanged)
  window.$preload.ipcRenderer.on('fusion-attach-task', fusionAttachTask)
  resolvePreferenceIdentity().finally(() => {
    preferencesReady = true
    refresh(true)
  })
  if (!isFusion)
    notificationPollTimer = setInterval(() => readNotifications(true), 4000)
  clockTimer = setInterval(tick, 1000)
  refreshTimer = setInterval(() => refresh(), 2500)
  wallpaperTimer = setInterval(() => {
    if (!isFusion && preferences.wallpaperSource === 'phone-live')
      syncPhoneWallpaper()
  }, 60000)
  if (!isFusion && preferences.wallpaperSource === 'phone-live')
    setTimeout(() => syncPhoneWallpaper(), 4000)
  window.$preload.ipcRenderer
    .invoke('desktop-host-action', 'state')
    .then(value => (hostFullscreen.value = Boolean(value)))
    .catch(() => {})
  observer = new ResizeObserver(reflowWindows)
  observer.observe(desktopEl.value)
  window.addEventListener('beforeunload', persistWindows)
  window.addEventListener('pointermove', pointerMove)
  window.addEventListener('pointerup', pointerUp)
  window.addEventListener('pointercancel', pointerUp)
  window.addEventListener('keydown', keydown)
  document.addEventListener('pointerdown', dismissOutside, true)
  window.$preload.ipcRenderer.on('desktop-native-pointer', dismissNative)
  window.$preload.ipcRenderer.on('desktop-wallpaper-frame', wallpaperFrame)
  window.$preload.ipcRenderer.on('desktop-wallpaper-status', wallpaperStatus)
  window.$preload.ipcRenderer.on('desktop-external-app', externalApp)
  window.$preload.ipcRenderer.on('desktop-app-frame-size', frameSizeChanged)
  window.$preload.ipcRenderer.on('desktop-app-activated', activated)
  window.$preload.ipcRenderer.on('desktop-app-exited', exited)
  window.$preload.ipcRenderer.on('desktop-native-error', nativeError)
})
onBeforeUnmount(() => {
  window.$preload.ipcRenderer.removeListener('fusion-launcher-blur', fusionBlur)
  window.$preload.ipcRenderer.removeListener('fusion-launcher-open', fusionOpen)
  window.$preload.ipcRenderer.removeListener('desktop-host-fullscreen', hostFullscreenChanged)
  window.$preload.ipcRenderer.removeListener('fusion-attach-task', fusionAttachTask)
  clearInterval(controlPoll)
  ++controlGeneration
  cancelCaptionPress()
  clearTimeout(shortcutPress.value?.timer)
  clearInterval(notificationPollTimer)
  for (const timer of bannerTimers.values()) clearTimeout(timer)
  for (const item of windows.value) rememberWindow(item)
  for (const change of Object.values(levelChanges)) clearTimeout(change.timer)
  clearInterval(clockTimer)
  clearInterval(refreshTimer)
  clearInterval(wallpaperTimer)
  clearTimeout(toastTimer)
  cancelAnimationFrame(panelAnimationFrame)
  cancelAnimationFrame(layoutFrame)
  observer?.disconnect()
  window.removeEventListener('beforeunload', persistWindows)
  window.removeEventListener('pointermove', pointerMove)
  window.removeEventListener('pointerup', pointerUp)
  window.removeEventListener('pointercancel', pointerUp)
  window.removeEventListener('keydown', keydown)
  document.removeEventListener('pointerdown', dismissOutside, true)
  window.$preload.ipcRenderer.removeListener(
    'desktop-native-pointer',
    dismissNative,
  )
  window.$preload.ipcRenderer.removeListener(
    'desktop-wallpaper-frame',
    wallpaperFrame,
  )
  window.$preload.ipcRenderer.removeListener(
    'desktop-wallpaper-status',
    wallpaperStatus,
  )
  window.$preload.ipcRenderer.removeListener(
    'desktop-app-activated',
    activated,
  )
  window.$preload.ipcRenderer.removeListener('desktop-external-app', externalApp)
  window.$preload.ipcRenderer.removeListener('desktop-app-frame-size', frameSizeChanged)
  window.$preload.ipcRenderer.removeListener('desktop-app-exited', exited)
  window.$preload.ipcRenderer.removeListener(
    'desktop-native-error',
    nativeError,
  )
})
</script>

<style scoped>
.fusion-launcher.dex-workspace:not(.fusion-app) {
  clip-path: inset(0 round 32px);
  --glass: var(--ui-canvas, rgba(27, 27, 27, 0.78));
  --desk-text: var(--ui-text, #f2f2f3);
  --desk-muted: var(--ui-muted, #94949b);
  --desk-control: var(--ui-control, #ffffff0d);
  --line: var(--ui-border, #36363b);
  background: transparent !important;
  background-image: none !important;
}
.fusion-start-button {
  position: absolute;
  bottom: 0;
  left: 0;
  width: 48px;
  height: 48px;
  border: 1px solid #ffffff38;
  border-radius: 12px;
  background: var(--glass);
  color: var(--desk-text);
  font-size: 34px;
  cursor: pointer;
}
.fusion-start-button:active {
  transform: scale(0.9);
}
.fusion-launcher .start-menu {
  background: var(--glass) !important;
  border-radius: 32px !important;
  overflow: hidden;
  box-shadow: none;
  bottom: 0 !important;
  height: 100vh !important;
  max-height: 100vh !important;
  left: 0;
  bottom: 56px;
  width: 100%;
  max-height: calc(100vh - 56px);
  height: calc(100vh - 56px);
  transform: none;
}
.fusion-launcher .menu-search,
.fusion-launcher .start-menu footer {
  background: var(--ui-control, #ffffff0d) !important;
}
.frequent-apps {
  margin: 12px 0;
}
.menu-search input {
  min-width: 0;
  flex: 1;
}
.menu-search .icon-button {
  flex: none;
}
.mirror-shortcut-icon {
  width: 42px;
  height: 42px;
  color: var(--desk-text);
  padding: 5px;
}
.fusion-app .app-titlebar:not(.revealed) {
  -webkit-app-region: no-drag;
  border-radius: 12px;
}
.fusion-app.fusion-fullscreen .app-window,
.fusion-app.fusion-fullscreen .app-surface {
  border-radius: 0;
}
.fusion-launcher .boot-screen {
  display: none;
}
.fusion-app.dex-workspace {
  background: transparent !important;
  background-image: none !important;
}
.fusion-app .app-window {
  border-radius: 16px;
}
.fusion-app .app-titlebar {
  width: 100%;
  height: 42px;
  opacity: 1;
  border-radius: 16px 16px 0 0;
  -webkit-app-region: drag;
}
.fusion-app .app-titlebar button,
.fusion-app .app-titlebar input {
  -webkit-app-region: no-drag;
}
.fusion-app .caption-grip,
.fusion-app .rightclick-switch,
.fusion-app .resolution-chip {
  display: none !important;
}
.fusion-app .app-titlebar .title-icon,
.fusion-app .app-titlebar .app-title,
.fusion-app .app-titlebar .window-actions {
  opacity: 1;
  visibility: visible;
}

.fusion-settings-toggle {
  display: flex;
  gap: 3px;
  margin-left: auto;
  padding: 6px;
}
.fusion-settings-toggle svg {
  width: 15px;
  height: 15px;
}
.fusion-app-settings {
  position: absolute;
  right: 8px;
  top: 48px;
  z-index: 15000;
  width: min(290px, calc(100vw - 16px));
  padding: 16px;
  border-radius: 14px;
  display: grid;
  gap: 14px;
}
.fusion-app-settings label,
.fusion-app-settings button {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
.fusion-app-settings select {
  max-width: 135px;
  background: var(--desk-control);
  color: var(--text);
  padding: 5px;
  border-radius: 6px;
}
.fusion-app-settings svg {
  width: 16px;
  height: 16px;
}
.fusion-app .resolution-panel {
  left: 8px !important;
  right: 8px;
  top: 48px !important;
  width: auto;
  max-height: calc(100vh - 56px);
  overflow-y: auto;
}
.dex-workspace {
  --glass: rgba(27, 27, 27, 0.84);
  --desk-text: #f7f7f7;
  --desk-muted: #c1c1c1;
  --desk-control: #ffffff0d;
  --desk-pressed: #ffffff26;
  --line: rgba(145, 145, 145, 0.48);
  --accent: #77baff;
  position: relative;
  width: 100vw;
  height: 100vh;
  overflow: hidden;
  background: #000;
  background-position: center;
  background-repeat: no-repeat;
  color: #f5f6fa;
  font-family: 'Segoe UI', 'Microsoft YaHei', sans-serif;
  font-size: 13px;
  user-select: none;
}
.desktop-host-actions {
  position: absolute;
  top: 13px;
  right: 14px;
  z-index: 11000;
  display: flex;
  gap: 3px;
  padding: 2px;
  border: 1px solid #ffffff15;
  border-radius: 7px;
  background: #15233866;
  backdrop-filter: blur(12px);
}
button,
input,
select {
  font: inherit;
}
button {
  cursor: pointer;
  color: inherit;
  border: 0;
  background: none;
}
button:disabled {
  opacity: 0.45;
  cursor: wait;
}
svg {
  width: 20px;
  height: 20px;
  flex-shrink: 0;
}
button:focus-visible,
input:focus-visible,
select:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
.glass {
  background: var(--glass);
  border: 1px solid var(--line);
  backdrop-filter: blur(48px) saturate(1.05);
  box-shadow: 0 12px 42px #0005;
  border-radius: 12px;
}
.device-chip {
  position: absolute;
  top: 15px;
  left: 18px;
  display: flex;
  align-items: center;
  gap: 9px;
  background: #15233888;
  border: 1px solid #ffffff19;
  border-radius: 24px;
  padding: 8px 13px;
  z-index: 11000;
  backdrop-filter: blur(14px);
}
.device-chip small {
  color: #c1c8d5;
  font-size: 11px;
}
.connection-dot {
  display: inline-block;
  width: 7px;
  height: 7px;
  margin-right: 3px;
  background: #dfac67;
  border-radius: 50%;
}
.connection-dot.online {
  background: #70dea8;
}
.blue {
  background: linear-gradient(135deg, #77c7ff, #1767d7);
}
.violet {
  background: linear-gradient(135deg, #bb9dfa, #6e45ba);
}
.app-window {
  container-type: inline-size;
  position: absolute;
  display: flex;
  flex-direction: column;
  background: transparent;
  border: 0;
  border-radius: 16px;
  overflow: visible;
  box-shadow: 0 10px 35px #0006;
  min-width: 120px;
  min-height: 160px;
}
.app-window.active {
  box-shadow: 0 16px 44px #0008;
}
.app-window.fullscreen {
  border: 0;
  border-radius: 0;
  min-width: 0;
  min-height: 0;
}
.app-window.maximized {
  border-radius: 0;
}
.app-titlebar {
  position: absolute;
  top: 8px;
  left: 50%;
  transform: translateX(-50%);
  width: 48px;
  height: 18px;
  z-index: 4;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  border-radius: 12px;
  background: #262e3de6;
  border: 1px solid #ffffff35;
  box-shadow: 0 2px 7px #0003;
  color: #f3f6ff;
  touch-action: none;
  cursor: grab;
}
.app-titlebar:not(.revealed) > :not(.caption-grip) {
  display: none;
}
.app-titlebar.dragging {
  cursor: grabbing;
  border-color: #a3d0ff;
}
.caption-grip {
  width: 22px;
  height: 3px;
  border-radius: 3px;
  background: #ffffffbb;
}
.app-titlebar.revealed {
  left: 6px;
  right: 6px;
  transform: none;
  width: auto;
  height: 38px;
  padding-left: 8px;
  background: #202735e8;
  backdrop-filter: blur(20px);
  box-shadow: 0 3px 14px #0003;
}
.app-titlebar.revealed .caption-grip {
  display: none;
}
.title-icon {
  width: 20px;
  height: 20px;
  object-fit: contain;
  flex-shrink: 0;
}
.app-title {
  flex: 1;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 12px;
}
.resolution-chip {
  min-width: 0;
  flex-shrink: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  display: flex;
  align-items: center;
  gap: 7px;
  border-radius: 5px;
  padding: 5px 8px;
  background: #ffffff0d;
  font-size: 11px;
  white-space: nowrap;
}
.rightclick-switch {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 3px;
  flex-shrink: 0;
  font-size: 10px;
  color: #aebbd0;
  white-space: nowrap;
}
.switch-track {
  display: block;
  width: 26px;
  height: 14px;
  border: 1px solid #aab7c47a;
  border-radius: 10px;
  background: #151d29;
  position: relative;
}
.switch-track i {
  display: block;
  position: absolute;
  top: 2px;
  left: 2px;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #aebbd0;
  transition: left 0.15s;
}
.rightclick-switch.enabled .switch-track {
  background: #9acbff;
  border-color: #9acbff;
}
.rightclick-switch.enabled .switch-track i {
  left: 14px;
  background: #173452;
}
.rightclick-switch.enabled {
  color: #c6e2ff;
}
@container (max-width: 600px) {
  .rightclick-label,
  .resolution-chip small {
    display: none;
  }
}
.resolution-chip small {
  font-size: 10px;
  color: #aab8cb;
}
.resolution-chip:hover {
  background: #ffffff1b;
}
.window-actions {
  flex-shrink: 0;
  margin-left: auto;
  display: flex;
  align-self: stretch;
  flex-shrink: 0;
}
.window-actions button {
  width: 36px;
  display: grid;
  place-items: center;
}
.window-actions svg {
  width: 14px;
  height: 14px;
}
.window-actions button:hover {
  background: #ffffff16;
}
.window-actions .close-action:hover {
  background: #d44747;
}
.app-surface {
  position: relative;
  flex: 1;
  min-height: 0;
  margin: 0;
  border-radius: inherit;
  overflow: hidden;
  background: transparent;
}
.surface-status {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  gap: 12px;
  padding: 28px;
  text-align: center;
  overflow: auto;
  color: #b6c1d0;
}
.surface-status img {
  width: 64px;
  height: 64px;
  object-fit: contain;
}
.surface-status p {
  font-size: 12px;
  max-width: 460px;
  overflow-wrap: anywhere;
}
.surface-status button {
  border: 1px solid #ffffff25;
  background: #ffffff12;
  border-radius: 6px;
  padding: 8px 14px;
}
.spinner {
  width: 20px;
  height: 20px;
  border: 2px solid #ffffff22;
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: spin 1s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
.resize-handle {
  position: absolute;
  z-index: 2;
  touch-action: none;
}
.resize-handle.n,
.resize-handle.s {
  height: 6px;
  left: 7px;
  right: 7px;
  cursor: ns-resize;
}
.resize-handle.n {
  top: -5px;
}
.resize-handle.s {
  bottom: -5px;
}
.resize-handle.e,
.resize-handle.w {
  width: 6px;
  top: 7px;
  bottom: 7px;
  cursor: ew-resize;
}
.resize-handle.e {
  right: -5px;
}
.resize-handle.w {
  left: -5px;
}
.resize-handle.ne,
.resize-handle.nw,
.resize-handle.se,
.resize-handle.sw {
  width: 12px;
  height: 12px;
}
.ne {
  top: -5px;
  right: -5px;
  cursor: nesw-resize;
}
.nw {
  top: -5px;
  left: -5px;
  cursor: nwse-resize;
}
.se {
  bottom: -5px;
  right: -5px;
  cursor: nwse-resize;
}
.sw {
  bottom: -5px;
  left: -5px;
  cursor: nesw-resize;
}
.taskbar {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 56px;
  background: transparent;
  border-top: none;
  z-index: 12000;
  display: flex;
  align-items: center;
  justify-content: center;
}
.task-context-menu {
  position: absolute;
  z-index: 15000;
  width: 220px;
  padding: 6px;
  border-radius: 12px;
}
.task-menu-title {
  padding: 8px 10px;
  font-size: 11px;
  color: #b8c2d5;
}
.task-context-menu button {
  display: block;
  width: 100%;
  text-align: left;
  padding: 10px;
  border-radius: 7px;
  font-size: 12px;
}
.task-context-menu button:hover {
  background: #ffffff18;
}
.taskbar-center {
  display: flex;
  align-items: center;
  gap: 4px;
  max-width: calc(100% - 400px);
  overflow-x: auto;
  scrollbar-width: none;
}
.task-button {
  width: 43px;
  height: 44px;
  flex-shrink: 0;
  display: grid;
  place-items: center;
  border-radius: 5px;
  position: relative;
  transition:
    background 0.15s,
    transform 0.16s cubic-bezier(0.2, 0.8, 0.2, 1);
}
.task-button:hover {
  filter: brightness(1.12);
}
.task-button:active {
  background: var(--desk-pressed);
  transform: scale(0.9);
}
.task-button:focus-visible {
  outline: 2px solid var(--line);
  outline-offset: -2px;
}
.task-button svg,
.task-button img {
  width: 26px;
  height: 26px;
  object-fit: contain;
}
.file-manager-button {
  color: #ffd361;
}
.file-manager-button svg {
  fill: #e8af38;
  stroke: #ffd875;
}
.start-button {
  color: #5fbeff;
}
.start-button svg {
  fill: currentColor;
  stroke-width: 0;
}
.running-app i {
  position: absolute;
  bottom: 2px;
  left: 18px;
  width: 7px;
  height: 3px;
  border-radius: 5px;
  background: #c7ccdc;
}
.running-app.selected i {
  width: 18px;
  left: 13px;
  background: #7ec6ff;
}
.task-divider {
  height: 24px;
  width: 1px;
  background: #ffffff22;
  margin: 0 6px;
}
.desktop-fullscreen-button {
  position: absolute;
  right: 16px;
  top: 16px;
  z-index: 12500;
  background: #20293bba;
}
.system-tray {
  position: absolute;
  right: 0;
  bottom: 0;
  height: 55px;
  display: flex;
  align-items: center;
  gap: 3px;
}
.tray-controls {
  height: 42px;
  padding: 0 10px;
  display: flex;
  align-items: center;
  gap: 9px;
  border-radius: 5px;
}
.tray-controls svg {
  width: 17px;
  height: 17px;
}
.tray-controls:hover,
.tray-clock:hover {
  background: #ffffff14;
}
.tray-clock {
  height: 44px;
  min-width: 86px;
  padding: 4px 9px;
  border-radius: 5px;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: flex-end;
  font-size: 11px;
  line-height: 17px;
}
.show-desktop {
  width: 6px;
  height: 42px;
  border-left: 1px solid #ffffff26;
  margin-left: 4px;
}
.show-desktop:hover {
  background: #ffffff55;
}
.start-menu {
  position: absolute;
  z-index: 12500;
  bottom: 68px;
  left: 50%;
  transform: translateX(-50%);
  width: min(580px, calc(100vw - 32px));
  height: min(620px, calc(100vh - 100px));
  padding: 28px 28px 0;
  display: flex;
  flex-direction: column;
}
.menu-search {
  height: 38px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 10px;
  background: #12151fcc;
  border: 1px solid #ffffff13;
  border-bottom: 2px solid #79bfff;
  border-radius: 5px;
  padding: 0 12px;
}
.menu-search svg {
  width: 17px;
  height: 17px;
  color: #a8b3c5;
}
.menu-search input {
  width: 100%;
  background: none;
  border: 0;
  outline: none;
  color: inherit;
  font-size: 12px;
}
.panel-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 16px;
}
.start-menu .panel-heading {
  margin: 18px 0 8px;
}
.panel-heading strong {
  font-weight: 600;
}
.icon-button {
  width: 30px;
  height: 30px;
  display: grid;
  place-items: center;
  border-radius: 5px;
  flex-shrink: 0;
}
.icon-button:hover {
  background: #ffffff16;
}
.icon-button svg {
  width: 17px;
  height: 17px;
}
.app-grid {
  flex: 1;
  min-height: 0;
  overflow: auto;
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  grid-auto-rows: 98px;
  align-content: start;
  gap: 5px 3px;
  padding: 8px 0 20px;
}
.launcher-app {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 9px;
  min-width: 0;
  border-radius: 6px;
  padding: 8px 3px;
}
.launcher-app:hover {
  background: #ffffff13;
}
.launcher-app img,
.fallback-icon {
  width: 42px;
  height: 42px;
  object-fit: contain;
  border-radius: 10px;
}
.fallback-icon {
  display: grid;
  place-items: center;
  background: #3a5c80;
  font-size: 22px;
}
.launcher-app > span:last-child {
  font-size: 11px;
  width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.menu-footer {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-top: 1px solid #ffffff15;
  background: #00000019;
  margin: 0 -28px;
  padding: 12px 28px;
  border-radius: 0 0 12px 12px;
}
.menu-footer > span {
  display: flex;
  align-items: center;
  gap: 7px;
}
.muted {
  color: #a5b0c3;
  font-size: 12px;
  line-height: 1.65;
}
.empty {
  padding: 24px;
  text-align: center;
}
.quick-settings,
.notification-panel,
.personalization,
.resolution-panel {
  position: absolute;
  z-index: 12500;
  right: 14px;
  bottom: 68px;
  width: 360px;
  padding: 24px;
  max-height: calc(100vh - 96px);
  overflow: auto;
}
.adb-control {
  width: min(370px, calc(100vw - 28px));
  border-radius: 22px;
}
.adb-control-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 20px;
}
.adb-control-header strong {
  flex: 1;
}
.adb-media {
  display: flex;
  justify-content: center;
  gap: 24px;
  margin: 18px 0;
}
.adb-volume {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 12px;
}
.adb-volume svg {
  width: 20px;
  height: 20px;
}
.adb-volume input {
  min-width: 0;
  flex: 1;
  accent-color: var(--accent, #aaa);
}
.adb-volume span {
  width: 38px;
  text-align: right;
  font-size: 12px;
}
.quick-settings.direct-control {
  padding: 0 !important;
  overflow: hidden;
  background: #111 !important;
}
.native-control-image {
  display: block;
  width: 100%;
  max-height: none;
  object-fit: contain;
  touch-action: none;
  user-select: none;
}
.native-panel-close {
  position: absolute;
  z-index: 2;
  top: 6px;
  right: 6px;
  color: white;
  background: #333b;
  border-radius: 50%;
}
.quick-settings.direct-control {
  width: min(410px, calc(100vw - 28px));
  padding: 20px;
  border-radius: 25px;
  background: color-mix(in srgb, var(--glass) 92%, transparent);
}
.direct-control-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 0 20px;
  min-height: 28px;
  font-size: 12px;
}
.direct-control-header > .icon-button {
  width: 26px;
  height: 26px;
}
.quick-status {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 11px;
}
.quick-status svg {
  width: 16px;
  height: 16px;
}
.quick-connections {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}
.quick-connection {
  min-height: 78px;
  border: 0;
  border-radius: 25px;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 16px;
  background: #ffffff13;
  color: var(--desk-text);
  text-align: left;
  touch-action: none;
}
.quick-connection.selected {
  background: #f5faf6;
  color: #101113;
}
.quick-connection > svg {
  width: 30px;
  height: 30px;
  flex-shrink: 0;
}
.quick-connection.selected > svg {
  color: #3588ff;
}
.quick-connection.selected.cellular > svg {
  color: #12bb40;
}
.quick-connection > span {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.quick-connection strong {
  font-size: 15px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.quick-connection small {
  font-size: 12px;
  opacity: 0.6;
}
.quick-media-levels {
  display: grid;
  grid-template-columns: 2fr 1fr 1fr;
  gap: 12px;
  margin: 16px 0 20px;
  height: 170px;
}
.quick-media-card {
  position: relative;
  border-radius: 27px;
  background: #00000025;
  padding: 26px 12px 12px;
  display: flex;
  flex-direction: column;
}
.quick-cast {
  position: absolute;
  top: 13px;
  right: 15px;
  width: 20px;
  height: 20px;
  opacity: 0.55;
}
.quick-track {
  display: flex;
  flex: 1;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  gap: 6px;
  text-align: center;
  min-width: 0;
}
.quick-track strong {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  font-size: 14px;
  font-weight: 500;
}
.quick-track small {
  max-width: 100%;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  opacity: 0.6;
  font-size: 11px;
}
.quick-media-buttons {
  display: flex;
  align-items: center;
  justify-content: space-around;
  gap: 2px;
}
.quick-media-buttons .icon-button {
  width: 34px;
  height: 34px;
}
.quick-media-buttons svg {
  width: 23px;
  height: 23px;
}
.quick-vertical-level {
  position: relative;
  display: block;
  overflow: hidden;
  border-radius: 27px;
  background: #00000028;
  min-width: 0;
}
.quick-level-fill {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  background: #f5f8fc;
  pointer-events: none;
}
.quick-vertical-level > svg {
  position: absolute;
  bottom: 17px;
  left: 50%;
  transform: translateX(-50%);
  width: 30px;
  height: 30px;
  color: #3888ff;
  pointer-events: none;
  z-index: 1;
}
.quick-vertical-level.brightness > svg {
  color: #ffa500;
}
.quick-vertical-level > input {
  position: absolute;
  inset: 0;
  opacity: 0;
  width: 100%;
  height: 100%;
  margin: 0;
  writing-mode: vertical-lr;
  direction: rtl;
  cursor: pointer;
  touch-action: none;
}
.quick-vertical-level:focus-within {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
.direct-quick-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 19px 10px;
}
.direct-quick-tile {
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 9px;
}
.direct-quick-tile > button {
  width: min(68px, 100%);
  aspect-ratio: 1;
  border: 0;
  border-radius: 50%;
  display: grid;
  place-items: center;
  background: #0000002c;
  color: #fff;
  touch-action: none;
  transition:
    transform 120ms ease,
    background 150ms ease;
}
.direct-quick-tile > button.selected {
  background: #f6fbf7;
  color: #3483ff;
}
.direct-quick-tile > button.selected.danger {
  color: #ff4f54;
}
.direct-quick-tile > button > svg,
.direct-quick-tile > button > img {
  width: 29px;
  height: 29px;
  object-fit: contain;
  pointer-events: none;
}
.direct-quick-tile > button > img {
  filter: brightness(0) invert(1);
}
.direct-quick-tile > button.selected > img {
  filter: invert(44%) sepia(96%) saturate(2190%) hue-rotate(202deg) brightness(103%);
}
.direct-quick-tile > span {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  font-size: 12px;
  text-align: center;
  line-height: 1.35;
  min-height: 32px;
  max-width: 100%;
  overflow-wrap: anywhere;
}
.quick-connection:active,
.direct-quick-tile > button:active {
  transform: scale(0.93);
}
.quick-loading,
.quick-error {
  padding: 16px 4px;
  line-height: 1.5;
  font-size: 12px;
}
.quick-error {
  color: var(--desk-muted);
}
.quick-error > button {
  padding: 5px 12px;
  margin-left: 9px;
  border-radius: 8px;
  background: var(--desk-control);
}
.quick-dialog > header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
}
.quick-dialog-text {
  margin: 15px 4px;
  font-size: 14px;
  line-height: 1.6;
  overflow-wrap: anywhere;
}
.quick-dialog-button {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 16px;
  margin: 8px 0;
  border: 1px solid var(--line);
  border-radius: 15px;
  background: var(--desk-control);
  color: var(--desk-text);
  text-align: left;
  line-height: 1.6;
}
.quick-dialog-button > span:first-child {
  flex: 1;
  overflow-wrap: anywhere;
}
.quick-dialog-button > svg {
  flex: 0 0 16px;
  width: 16px;
  height: 16px;
  opacity: 0.6;
}
.quick-dialog-switch {
  position: relative;
  width: 32px;
  height: 19px;
  border-radius: 10px;
  background: #8888;
  flex-shrink: 0;
}
.quick-dialog-switch::after {
  content: '';
  position: absolute;
  width: 13px;
  height: 13px;
  left: 3px;
  top: 3px;
  background: white;
  border-radius: 50%;
}
.quick-dialog-switch.checked {
  background: #3488ff;
}
.quick-dialog-switch.checked::after {
  left: 16px;
}
.quick-dialog-input,
.quick-dialog-range {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin: 14px 0;
}
.quick-dialog-input input {
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 10px;
  background: var(--desk-control);
  color: var(--desk-text);
}
.theme-light .direct-quick-tile > button:not(.selected),
.theme-light .quick-media-card,
.theme-light .quick-vertical-level {
  background: #3b3e4566;
}

.quick-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 20px 12px;
  margin-bottom: 28px;
}
.quick-tile {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  font-size: 11px;
}
.quick-tile > button {
  height: 49px;
  width: 100%;
  border: 1px solid #ffffff1c;
  border-radius: 5px;
  background: #ffffff0b;
  display: grid;
  place-items: center;
}
.quick-tile > button:hover {
  background: #ffffff20;
}
.quick-tile > button.selected {
  background: #b5d8fc;
  color: #12243a;
  border-color: #b5d8fc;
}
.quick-tile svg {
  width: 20px;
  height: 20px;
}
.level-row {
  display: flex;
  align-items: center;
  gap: 13px;
  margin: 18px 0;
}
.level-row > svg {
  width: 19px;
  height: 19px;
}
.level-row input {
  flex: 1;
  min-width: 0;
  accent-color: #a3d0ff;
  height: 24px;
  margin: 0;
  cursor: pointer;
  touch-action: none;
}
.level-row > span {
  font-size: 10px;
  color: #9faac0;
  width: 30px;
  text-align: right;
}
.quick-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: #00000019;
  border-top: 1px solid #ffffff0c;
  margin: 24px -24px -24px;
  padding: 10px 22px;
}
.quick-footer > span {
  display: flex;
  gap: 8px;
  align-items: center;
  font-size: 11px;
}
.quick-footer svg {
  width: 17px;
  height: 17px;
}
.notification-panel {
  width: 370px;
}
.notification-panel {
  border-radius: 20px;
}
.notification-group {
  background: #ffffff0b;
  border: 1px solid #ffffff0d;
  border-radius: 18px;
  margin: 12px 0;
  padding: 14px 16px;
}
.notification-app-heading {
  display: flex;
  align-items: center;
  gap: 9px;
  color: #d1d7e3;
  font-size: 12px;
  margin-bottom: 6px;
}
.notification-app-heading img,
.notification-app-heading svg {
  width: 23px;
  height: 23px;
  border-radius: 7px;
}
.notification-app-heading small {
  margin-left: auto;
  color: #9aa7bf;
}
.phone-notification {
  padding: 10px 0;
}
.phone-notification + .phone-notification {
  border-top: 1px solid #ffffff0d;
}
.phone-notification header {
  display: flex;
  align-items: baseline;
  gap: 12px;
}
.phone-notification strong {
  font-size: 13px;
  font-weight: 600;
  min-width: 0;
  overflow-wrap: anywhere;
}
.phone-notification time {
  margin-left: auto;
  font-size: 10px;
  flex-shrink: 0;
  color: #9da8bc;
}
.phone-notification p {
  font-size: 12px;
  line-height: 1.6;
  color: #d1d7e3;
  margin: 6px 0 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.notification-empty {
  text-align: center;
  padding: 48px 0;
  color: #a7b2c6;
  font-size: 13px;
}
.personalization {
  width: 400px;
}
.wallpaper-preview {
  height: 150px;
  background: #000;
  background-position: center;
  background-repeat: no-repeat;
  border: 1px solid #ffffff1c;
  border-radius: 7px;
  margin-bottom: 18px;
}
.personalization label,
.resolution-panel > label {
  display: flex;
  flex-direction: column;
  gap: 8px;
  font-size: 12px;
  margin: 14px 0;
}
.personalization select,
.resolution-panel select,
.resolution-panel input[type='number'] {
  background: #141923;
  color: #e6ebf4;
  border: 1px solid #ffffff26;
  border-radius: 5px;
  padding: 8px 10px;
  min-width: 0;
}
.settings-buttons {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin: 16px 0;
}
.settings-buttons button {
  border: 1px solid #ffffff25;
  background: #ffffff0e;
  padding: 8px 13px;
  border-radius: 5px;
  font-size: 12px;
}
.settings-buttons button:hover {
  background: #ffffff1e;
}
.settings-buttons .primary-button {
  background: #a9d0fc;
  color: #15263c;
  border-color: #a9d0fc;
}
.inline-error {
  color: #ffc2b6;
  font-size: 12px;
  line-height: 1.6;
  overflow-wrap: anywhere;
}
.resolution-panel {
  top: 74px;
  bottom: auto;
  width: 380px;
}
.resolution-fields {
  display: flex;
  gap: 12px;
  align-items: flex-end;
}
.resolution-fields label {
  display: flex;
  flex-direction: column;
  gap: 8px;
  flex: 1;
  min-width: 0;
  font-size: 12px;
}
.resolution-fields > span {
  padding-bottom: 8px;
  color: #929eb0;
}
.resolution-fields input {
  width: 100%;
}
.resolution-panel .checkbox-label {
  flex-direction: row;
  align-items: center;
  gap: 8px;
  font-size: 11px;
  color: #c6d0df;
}
.checkbox-label input {
  accent-color: #a9d0fc;
}
.fullscreen-float {
  position: absolute;
  z-index: 14000;
  right: -20px;
  top: 45%;
  display: flex;
  align-items: center;
  flex-direction: row-reverse;
  gap: 10px;
  transition: right 0.18s;
}
.fullscreen-float:hover,
.fullscreen-float.expanded {
  right: 10px;
}
.float-ball {
  width: 44px;
  height: 44px;
  border-radius: 50%;
  background: #263249cd;
  border: 1px solid #ffffff45;
  backdrop-filter: blur(15px);
  box-shadow: 0 3px 20px #0005;
  display: grid;
  place-items: center;
  color: #92cbff;
}
.float-ball svg {
  width: 20px;
  height: 20px;
}
.float-menu {
  padding: 7px;
  width: 150px;
}
.float-menu button {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px;
  width: 100%;
  font-size: 12px;
  border-radius: 5px;
}
.float-menu button:hover {
  background: #ffffff16;
}
.float-menu svg {
  width: 16px;
  height: 16px;
}
.boot-screen {
  position: absolute;
  z-index: 15000;
  inset: 0;
  border: 0;
  border-radius: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  background: #17233de8;
}
.boot-mark {
  color: #78bfff;
}
.boot-mark svg {
  width: 46px;
  height: 46px;
  fill: currentColor;
  stroke: 0;
}
.boot-screen h2 {
  font-size: 21px;
  font-weight: 500;
  margin: 22px 0 8px;
}
.boot-screen p {
  font-size: 12px;
  color: #b1bfd3;
}
.boot-track {
  width: 260px;
  height: 3px;
  background: #ffffff18;
  border-radius: 5px;
  margin-top: 18px;
  overflow: hidden;
}
.boot-track span {
  display: block;
  height: 100%;
  background: #88c8ff;
  transition: width 0.3s;
}
.toast {
  position: absolute;
  z-index: 16000;
  left: 50%;
  bottom: 80px;
  transform: translateX(-50%);
  padding: 11px 18px;
  font-size: 12px;
  max-width: 75vw;
  overflow-wrap: anywhere;
}
.fullscreen .app-surface {
  height: 100%;
  margin: 0;
}
.maximized .app-surface {
  margin: 0;
}
@media (max-width: 1000px) {
  .taskbar-center {
    max-width: calc(100% - 310px);
    margin-right: 130px;
  }
  .resolution-chip small {
    display: none;
  }
  .app-grid {
    grid-template-columns: repeat(4, 1fr);
  }
}
@container (max-width: 340px) {
  .app-titlebar {
    gap: 4px;
    padding-left: 7px;
  }
  .resolution-chip {
    max-width: 88px;
    padding: 4px;
    font-size: 10px;
  }
  .window-actions button {
    width: 28px;
  }
}
@container (max-width: 270px) {
  .resolution-chip {
    display: none;
  }
}
@container (max-width: 185px) {
  .rightclick-switch,
  .title-icon {
    display: none;
  }
}

.dex-workspace.theme-light {
  --glass: rgba(218, 218, 218, 0.85);
  --line: rgba(255, 255, 255, 0.9);
  --desk-text: #111;
  --desk-muted: #4a4a4a;
  --desk-control: #ffffff40;
  --desk-pressed: #0000001a;
}
.dex-workspace {
  color: var(--desk-text);
}
.app-titlebar,
.app-titlebar.revealed,
.float-ball,
.float-menu {
  background: var(--glass);
  color: var(--desk-text);
  border: 1px solid var(--line);
  backdrop-filter: blur(48px);
}
.device-chip,
.desktop-fullscreen-button {
  background: var(--glass);
  color: var(--desk-text);
  border-color: var(--line);
}
.device-chip small {
  color: var(--desk-muted);
}
.caption-grip {
  background: currentColor;
}
.app-titlebar:not(.revealed) {
  color: var(--desk-muted);
}
.glass,
.personalization,
.quick-settings,
.notification-panel,
.start-menu,
.resolution-panel,
.task-context-menu {
  color: var(--desk-text);
}
.dex-workspace
  :is(
    .muted,
    .notification-app-heading,
    .phone-notification p,
    .notification-empty,
    .task-menu-title,
    .level-row > span,
    .phone-notification time,
    .notification-app-heading small
  ) {
  color: var(--desk-muted);
}
.dex-workspace
  :is(input, select, .resolution-chip, .notification-group, .surface-status button, .settings-buttons button) {
  color: var(--desk-text);
  background-color: var(--desk-control);
  border-color: var(--line);
}
.task-button.dragging {
  opacity: 0.45;
}
.panel-enter-active,
.panel-leave-active {
  transition:
    translate 0.2s cubic-bezier(0.2, 0.8, 0.2, 1),
    opacity 0.16s ease;
}
.panel-leave-active {
  pointer-events: none;
}
.panel-enter-from,
.panel-leave-to {
  translate: 0 22px;
  opacity: 0;
}
@media (prefers-reduced-motion: reduce) {
  .panel-enter-active,
  .panel-leave-active {
    transition-duration: 0.01ms;
  }
}

.desktop-shortcuts {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 1;
}
.desktop-shortcut {
  position: absolute;
  width: 84px;
  height: 88px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 7px;
  border-radius: 9px;
  pointer-events: auto;
  touch-action: none;
  color: #fff;
  text-shadow: 0 1px 4px #000;
}
.desktop-shortcut img,
.desktop-shortcut svg {
  width: 44px;
  height: 44px;
  object-fit: contain;
}
.desktop-shortcut span {
  max-width: 80px;
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.desktop-shortcut:active,
.desktop-shortcut:focus-visible {
  background: #ffffff20;
}
.frequent-grid {
  grid-template-columns: repeat(6, minmax(0, 1fr));
  grid-auto-rows: 84px;
  flex: none;
  max-height: 100px;
  overflow: hidden;
}
.frequent-app {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 9px;
  padding: 8px;
  border-radius: 8px;
  min-width: 0;
}
.frequent-app img {
  width: 40px;
  height: 40px;
  object-fit: contain;
}
.frequent-app span {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 12px;
  white-space: nowrap;
}
.frequent-app:hover {
  background: var(--desk-control);
}
.frequent-empty {
  margin: 0 0 16px;
  font-size: 12px;
}
.notification-banners {
  position: absolute;
  right: 18px;
  bottom: 74px;
  width: min(340px, calc(100vw - 36px));
  display: flex;
  flex-direction: column;
  gap: 10px;
  z-index: 16000;
  pointer-events: none;
}
.notification-banner {
  pointer-events: auto;
  padding: 15px 17px;
  cursor: pointer;
  color: var(--desk-text);
}
.notification-banner header {
  display: flex;
  align-items: center;
  gap: 9px;
  margin-bottom: 10px;
}
.notification-banner header img {
  width: 22px;
  height: 22px;
  border-radius: 6px;
}
.notification-banner header strong {
  flex: 1;
  font-size: 12px;
}
.notification-banner > strong {
  display: block;
  font-size: 13px;
}
.notification-banner p {
  margin: 6px 0 0;
  line-height: 1.5;
  color: var(--desk-muted);
  max-height: 54px;
  overflow: hidden;
}
.phone-notification {
  cursor: pointer;
  border-radius: 8px;
}
.phone-notification:hover {
  background: var(--desk-control);
}
.notification-dismiss {
  width: 22px;
  height: 22px;
  flex-shrink: 0;
}
.notification-dismiss svg {
  width: 12px;
  height: 12px;
}

.system-tray {
  color: #fff;
  text-shadow: 0 1px 3px #0008;
}
.device-chip {
  background: var(--glass);
  color: var(--desk-text);
  border: 1px solid var(--line);
  backdrop-filter: blur(48px);
}

.dex-workspace {
  color-scheme: dark;
}
.dex-workspace.theme-light {
  color-scheme: light;
}
.dex-workspace select option {
  background: #272727;
  color: #f7f7f7;
}
.dex-workspace.theme-light select option {
  background: #e6e6e6;
  color: #111;
}
.dex-workspace select option:checked {
  background: #555;
  color: #fff;
}
.dex-workspace.theme-light select option:checked {
  background: #c4c4c4;
  color: #111;
}
.menu-search {
  border-radius: 10px;
  background: #101010b8;
  border-color: #ffffff24;
  border-bottom-color: #8b8b8b;
  color: var(--desk-text);
}
.theme-light .menu-search {
  background: #ffffffe0;
  border-color: #ffffffdd;
  border-bottom-color: #909090;
}
.dex-workspace .menu-search input {
  background: transparent;
  color: inherit;
  min-width: 0;
  height: 100%;
  padding: 0;
  border-radius: 0;
  box-shadow: none;
}
.dex-workspace .menu-search input:focus-visible {
  outline: none;
}
.menu-search input::placeholder,
.menu-search svg {
  color: var(--desk-muted);
}
.app-titlebar:not(.revealed) {
  display: grid;
  place-items: center;
  gap: 0;
  padding: 0;
  overflow: hidden;
  border-radius: 999px;
  border-color: #3c3c3c;
  background: #101010;
  color: #bcbcbc;
}
.app-titlebar:not(.revealed) .caption-grip {
  width: 22px;
  height: 3px;
  margin: 0;
  padding: 0;
  transform: none;
  border-radius: 999px;
  background: #bcbcbc;
}
.notification-expand {
  margin-left: auto;
  border-radius: 50%;
  background: var(--desk-control);
}
.notification-group.collapsed .phone-notification {
  padding: 4px 0;
  border: 0;
}
.notification-group.collapsed .phone-notification header {
  min-width: 0;
}
.notification-group.collapsed .phone-notification header strong {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.notification-group.collapsed .phone-notification p,
.notification-group.collapsed .phone-notification time {
  display: none;
}
.device-battery {
  display: inline-flex;
  align-items: center;
  --battery-body: #303030;
  --battery-fill: #777;
  --battery-text: #fff;
  --battery-line: #e5e5e5;
}
.theme-light .device-battery {
  --battery-body: #dedede;
  --battery-fill: #a5a5a5;
  --battery-text: #111;
  --battery-line: #444;
}
.tray-controls .device-battery svg {
  width: 39px;
  height: 20px;
  overflow: visible;
}
.battery-body {
  fill: var(--battery-body);
  stroke: var(--battery-line);
  stroke-width: 1;
}
.battery-fill {
  fill: var(--battery-fill);
}
.battery-tip {
  stroke: var(--battery-line);
  stroke-width: 2;
  stroke-linecap: round;
}
.device-battery text {
  fill: var(--battery-text);
  font:
    700 10px 'Segoe UI',
    sans-serif;
  letter-spacing: -0.4px;
}
.battery-charge {
  fill: currentColor;
}

/* Fusion uses the system frame; the video has no artificial rounded mask. */
.fusion-app.dex-workspace {
  background: #202020 !important;
}
.fusion-app .app-window,
.fusion-app .app-surface {
  border-radius: 0 !important;
  box-shadow: none !important;
}
.fusion-app:not(.fusion-fullscreen) .app-surface {
  margin-top: 32px;
}
.fusion-app .app-titlebar.revealed {
  height: 32px;
  padding: 0 142px 0 8px;
  gap: 6px;
  border: 0;
  border-radius: 0;
  box-shadow: none;
  backdrop-filter: none;
  background: #202020;
  color: #ffffff;
  cursor: default;
  -webkit-app-region: drag;
}
.fusion-app .app-titlebar .title-icon {
  width: 16px;
  height: 16px;
}
.fusion-app .app-titlebar .window-actions button,
.fusion-app .fusion-settings-toggle {
  width: 30px;
  height: 30px;
  padding: 5px;
  border-radius: 0;
  flex-shrink: 0;
}
.fusion-app .fusion-settings-toggle {
  width: 38px;
}
.fusion-app .app-titlebar .app-title {
  display: block;
}
.fusion-app .fusion-app-settings {
  top: 36px;
}
</style>
