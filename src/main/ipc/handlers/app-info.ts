import { app, ipcMain } from 'electron'
import { IPC_CHANNELS, type AppInfo } from '../../../shared/contracts/ipc'

export function registerAppInfoHandler(): void {
  ipcMain.handle(IPC_CHANNELS.APP_GET_INFO, (): AppInfo => {
    return {
      name: app.getName(),
      version: app.getVersion(),
      electronVersion: process.versions.electron,
      chromeVersion: process.versions.chrome,
      nodeVersion: process.versions.node,
      platform: process.platform,
      arch: process.arch
    }
  })
}
