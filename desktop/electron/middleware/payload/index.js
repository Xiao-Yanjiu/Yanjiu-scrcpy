import minimist from 'minimist'
import { decodePayload } from '@yanjiu-scrcpy/electron-setup/main'

function getPayload() {
  const args = minimist(window.process.argv.slice(1))
  return decodePayload(args.payload)
}

export default getPayload()
