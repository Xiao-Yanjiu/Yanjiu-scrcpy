import { createLinuxAfterInstall } from './linux-after-install.js'

// Basic packages deliberately do not modify sandbox or device permissions.
const afterInstall = createLinuxAfterInstall()

export const linux = {
  icon: 'logo.png',
  maintainer: 'viarotel@qq.com',
  category: 'Utility',
  target: [
    { target: 'AppImage', arch: ['x64', 'arm64'] },
    { target: 'deb', arch: ['x64', 'arm64'] },
    { target: 'flatpak', arch: ['x64', 'arm64'] },
  ],
  artifactName: '${productName}-${version}-linux-${arch}.${ext}',
  extraResources: {
    from: 'electron/resources/extra',
    to: 'extra',
    filter: ['common', 'linux', 'linux-${arch}'],
  },
}

export const flatpak = {
  runtime: 'org.freedesktop.Platform',
  runtimeVersion: '25.08',
  sdk: 'org.freedesktop.Sdk',
  base: 'org.electronjs.Electron2.BaseApp',
  baseVersion: '25.08',
  finishArgs: [
    '--share=network',
    '--share=ipc',
    '--socket=x11',
    '--socket=wayland',
    '--socket=pulseaudio',
    '--device=all',
    '--filesystem=home',
    '--filesystem=xdg-download',
    '--talk-name=org.freedesktop.Notifications',
    '--talk-name=org.kde.StatusNotifierWatcher',
    '--system-talk-name=org.freedesktop.UDisks2',
  ],
}

export const deb = {
  afterInstall,
}

export const rpm = {
  afterInstall,
}
