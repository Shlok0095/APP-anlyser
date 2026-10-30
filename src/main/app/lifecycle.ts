import { join } from 'node:path'
import { app, BrowserWindow } from 'electron'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import { registerIpcHandlers } from '../ipc/register'
import { registerPermissionHandlers } from '../security/permissions'
import { hardenAppSession } from '../security/session'
import { SettingsStore } from '../services/settings-store'
import { createMainWindow } from '../windows/main-window'
import { JobStore, jobStorePath } from '../storage/job-store'
import { JobManager } from '../jobs/manager'

export function registerAppLifecycle(): void {
  app.whenReady().then(() => {
    electronApp.setAppUserModelId('com.uaa.desktop')
    hardenAppSession()
    registerPermissionHandlers()

    const userData = app.getPath('userData')
    const settingsStore = new SettingsStore(join(userData, 'settings.json'))
    const jobStore = new JobStore(jobStorePath(userData))
    const jobManager = new JobManager(
      jobStore,
      join(userData, 'artifacts'),
      join(userData, 'reports')
    )
    registerIpcHandlers(settingsStore, jobManager, jobStore)

    app.on('browser-window-created', (_event, window) => {
      optimizer.watchWindowShortcuts(window)
    })

    createMainWindow()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createMainWindow()
      }
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit()
    }
  })
}
