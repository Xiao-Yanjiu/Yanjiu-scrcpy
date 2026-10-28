import { ipcRenderer } from 'electron'
import minimist from 'minimist'
import { decodePayload } from '@yanjiu-scrcpy/electron-setup/main'

function getPayload() {
  const args = minimist(window.process.argv.slice(1))
  if (args['payload-ipc'])
    return ipcRenderer.sendSync('yanjiu:window-payload')
  return decodePayload(args.payload)
}

export default getPayload()
