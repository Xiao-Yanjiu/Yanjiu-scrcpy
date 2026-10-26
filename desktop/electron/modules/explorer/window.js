import { createWindowManager } from '@yanjiu-scrcpy/electron-setup/main'

export default {
  name: 'module:explorer:window',
  apply(mainApp) {
    createWindowManager('pages/explorer', {
      singleton: false,
    })
  },
}
