import { BrowserWindow, ipcMain } from 'electron'
import { analysisInputSchema, IPC_CHANNELS } from '../../../shared/contracts/ipc'
import { IPC_EVENTS } from '../../../shared/contracts/channels'
import type { JobManager } from '../../jobs/manager'
import type { AppSettings } from '../../../shared/contracts/ipc'

export function registerJobHandlers(manager: JobManager, getSettings: () => AppSettings): void {
  manager.onEvent((event) => {
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send(IPC_EVENTS.JOB, event)
    }
  })

  ipcMain.handle(IPC_CHANNELS.JOBS_LIST, () => manager.list())
  ipcMain.handle(IPC_CHANNELS.JOBS_GET, (_event, id: unknown) => {
    if (typeof id !== 'string') {
      throw new Error('Job id must be a string.')
    }
    return manager.get(id) ?? null
  })
  ipcMain.handle(IPC_CHANNELS.JOBS_CREATE, async (_event, payload: unknown) => {
    const parsed = analysisInputSchema.safeParse(payload)
    if (!parsed.success) {
      const issue = parsed.error.issues[0]?.message
      throw new Error(issue || 'Invalid analysis input.')
    }
    const settings = getSettings()
    return await manager.create(parsed.data, {
      mode: settings.aiMode,
      endpoint: settings.aiMode === 'off' ? undefined : settings.localAiUrl,
      nvidiaApiKey: settings.nvidiaApiKey,
      nvidiaModel: settings.nvidiaModel,
      openaiApiKey: settings.openaiApiKey,
      openaiBaseUrl: settings.openaiBaseUrl,
      openaiModel: settings.openaiModel
    })
  })
  ipcMain.handle(IPC_CHANNELS.JOBS_READ_REPORT, (_event, id: unknown) => {
    if (typeof id !== 'string') {
      throw new Error('Job id must be a string.')
    }
    return manager.readMarkdown(id)
  })
  ipcMain.handle(IPC_CHANNELS.JOBS_READ_EVIDENCE, (_event, id: unknown) => {
    if (typeof id !== 'string') {
      throw new Error('Job id must be a string.')
    }
    return manager.readEvidence(id)
  })
  ipcMain.handle(IPC_CHANNELS.JOBS_CANCEL, (_event, id: unknown) => {
    if (typeof id !== 'string') {
      throw new Error('Job id must be a string.')
    }
    return manager.cancel(id) ?? null
  })
}
