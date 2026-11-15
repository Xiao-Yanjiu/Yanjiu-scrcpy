import { defineStore } from 'pinia'
import dayjs from 'dayjs'
import { capitalize } from 'lodash-es'
import { name as packageName } from '$root/package.json'
import {
  getCurrentDevices,
  getHistoryDevices,
  mergeDevices,
  saveDevicesToStore,
} from './helpers/index.js'

const $electronStore = window.$preload.store

export const useDeviceStore = defineStore('app-device', () => {
  const list = ref([])
  const config = ref({})

  function init() {
    config.value = {
      ...($electronStore.get('device') || {}),
    }
    return config.value
  }

  function getLabel(device, params) {
    const data = device?.id
      ? device
      : list.value.find(item => item.id === device)

    if (!data) {
      return ''
    }

    const appName = capitalize(packageName)
    const deviceSerial = data.id.replaceAll(/[<>:"/\\|?*]/g, '_')
    // Fallback for devices without remark/name (e.g. partially hydrated payloads)
    // so labels and generated file names never contain a literal `undefined`.
    const displayName = data.remark || data.name || window.t?.('common.unknownDevice') || 'Unknown Device'
    const deviceName = `${displayName}[${deviceSerial}]`
    const currentTime = dayjs().format('YYYYMMDDHHmmss')
    let value = `${deviceName}-${appName}`

    const createPreset = type => `${deviceName}-${capitalize(type)}-${appName}`

    const presets = {
      screenshot: `${deviceName}-Screenshot-${currentTime}`,
      name: deviceName,
    }

    if (typeof params === 'function') {
      value = params({
        data,
        appName,
        deviceName,
        currentTime,
      })
    }
    else if (params && typeof params === 'string') {
      value = presets[params] || createPreset(params)
    }

    return value
  }

  const removedDevicesKey = 'removedDeviceIds'

  function remove(...devices) {
    const ids = new Set(devices.map(device => device.id ?? device))
    const stored = { ...($electronStore.get('device') || {}) }
    for (const id of ids) {
      delete stored[id]
    }
    const removedDeviceIds = new Set($electronStore.get(removedDevicesKey) || [])
    for (const id of ids) {
      removedDeviceIds.add(id)
    }
    $electronStore.set(removedDevicesKey, [...removedDeviceIds])
    $electronStore.set('device', stored)
    list.value = list.value.filter(device => !ids.has(device.id))
    config.value = stored
  }

  let listPending
  function getList() {
    listPending ||= (async () => {
      const currentDevices = await getCurrentDevices()
      const removedDeviceIds = new Set($electronStore.get(removedDevicesKey) || [])
      const removedDeviceCount = removedDeviceIds.size
      for (const device of currentDevices) {
        if (device.status === 'device' || device.status === 'unauthorized') {
          removedDeviceIds.delete(device.id)
        }
      }
      // Read history after the await so an in-flight scan cannot undo deletion.
      const historyDevices = getHistoryDevices()
      const mergedDevices = mergeDevices(historyDevices, currentDevices)
        .filter(device => !removedDeviceIds.has(device.id))
      saveDevicesToStore(mergedDevices)
      if (removedDeviceIds.size !== removedDeviceCount) {
        $electronStore.set(removedDevicesKey, [...removedDeviceIds])
      }
      list.value = mergedDevices
      return mergedDevices
    })().finally(() => { listPending = null })
    return listPending
  }

  function setRemark(deviceId, value) {
    $electronStore.set(['device', deviceId, 'remark'], value)
    init()
  }

  return {
    list,
    config,
    init,
    getLabel,
    getList,
    remove,
    setRemark,
  }
})
