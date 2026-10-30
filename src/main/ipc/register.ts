import type { SettingsStore } from '../services/settings-store'
import type { JobManager } from '../jobs/manager'
import type { JobStore } from '../storage/job-store'
import { registerAppInfoHandler } from './handlers/app-info'
import { registerSettingsHandlers } from './handlers/settings'
import { registerJobHandlers } from './handlers/jobs'
import { registerDialogHandlers } from './handlers/dialogs'
import { registerDeviceHandlers } from './handlers/devices'

export function registerIpcHandlers(
  settingsStore: SettingsStore,
  jobManager: JobManager,
  jobStore: JobStore
): void {
  registerAppInfoHandler()
  registerSettingsHandlers(settingsStore)
  registerJobHandlers(jobManager, () => settingsStore.read())
  registerDialogHandlers()
  registerDeviceHandlers(jobStore)
}
