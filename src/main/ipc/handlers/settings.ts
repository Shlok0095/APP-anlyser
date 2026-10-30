import { ipcMain } from 'electron'
import { IPC_CHANNELS, settingsPatchSchema } from '../../../shared/contracts/ipc'
import type { SettingsStore } from '../../services/settings-store'

export function registerSettingsHandlers(store: SettingsStore): void {
  ipcMain.handle(IPC_CHANNELS.SETTINGS_GET, () => {
    return store.read()
  })

  ipcMain.handle(IPC_CHANNELS.SETTINGS_SET, (_event, payload: unknown) => {
    const parsed = settingsPatchSchema.safeParse(payload)
    if (!parsed.success) {
      throw new Error('Invalid settings payload.')
    }
    return store.write(parsed.data)
  })
}
