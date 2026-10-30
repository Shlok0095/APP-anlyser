import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '../../../shared/contracts/ipc'
import { parseAdbDevices } from '../../../engines/android/device'
import { findOnPath, runCommand } from '../../../engines/base/spawn'
import type { JobStore } from '../../storage/job-store'
import { listEngines } from '../../../engines/registry'

export function registerDeviceHandlers(store: JobStore): void {
  ipcMain.handle(IPC_CHANNELS.DEVICES_LIST, async () => {
    const adb = findOnPath('adb')
    if (!adb) {
      return []
    }
    const result = await runCommand(adb, ['devices', '-l'], { timeoutMs: 8000 })
    return parseAdbDevices(result.stdout)
  })

  ipcMain.handle(IPC_CHANNELS.DEVICES_PACKAGES, async (_event, deviceId: unknown) => {
    if (typeof deviceId !== 'string') {
      throw new Error('Device id must be a string.')
    }
    const adb = findOnPath('adb')
    if (!adb) {
      return []
    }
    const result = await runCommand(adb, ['-s', deviceId, 'shell', 'pm', 'list', 'packages'], {
      timeoutMs: 15_000
    })
    return result.stdout
      .split(/\r?\n/)
      .map((line) => line.replace(/^package:/, '').trim())
      .filter(Boolean)
  })

  ipcMain.handle(IPC_CHANNELS.ENGINES_LIST, () => listEngines().map((engine) => engine.descriptor))
  ipcMain.handle(IPC_CHANNELS.JOBS_DASHBOARD, async () => {
    const adb = findOnPath('adb')
    const devices = adb
      ? parseAdbDevices((await runCommand(adb, ['devices', '-l'], { timeoutMs: 8000 })).stdout)
      : []
    return store.snapshot(
      listEngines(),
      devices.map((device) => ({
        id: device.id,
        label: device.id,
        status: device.status
      }))
    )
  })
}
