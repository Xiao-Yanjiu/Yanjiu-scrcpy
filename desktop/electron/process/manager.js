import treeKill from '@magda/tree-kill'

/**
 * Process Manager
 */
export class ProcessManager {
  processList = []

  constructor() {
    this.processList = []
  }

  add(process) {
    this.processList.push(process)
    const remove = () => {
      this.processList = this.processList.filter(item => item !== process)
    }
    process.once('exit', remove)
    process.once('error', remove)
  }

  async kill(process) {
    if (!process) {
      for (const item of this.processList) {
        if (item.pid && item.exitCode == null && item.signalCode == null && !item.killed)
          await treeKill(item.pid, 'SIGTERM')
      }

      this.processList = []
      return this
    }

    const pid = process?.pid || process
    await treeKill(pid, 'SIGTERM')
    this.processList = this.processList.filter(item => item.pid !== pid)
    return this
  }
}
