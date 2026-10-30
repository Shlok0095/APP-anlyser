import { resolve } from 'node:path'
import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { IPC_CHANNELS } from '../../../shared/contracts/ipc'

export function registerDialogHandlers(): void {
  ipcMain.handle(
    IPC_CHANNELS.DIALOG_FILE,
    async (event, filters?: Array<{ name: string; extensions: string[] }>) => {
      const window = BrowserWindow.fromWebContents(event.sender)
      const options = {
        properties: ['openFile'] as Array<'openFile'>,
        filters: filters ?? [{ name: 'All files', extensions: ['*'] }]
      }
      const result = window
        ? await dialog.showOpenDialog(window, options)
        : await dialog.showOpenDialog(options)
      return result.canceled ? null : (result.filePaths[0] ?? null)
    }
  )
  ipcMain.handle(IPC_CHANNELS.DIALOG_FOLDER, async (event) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    const options = { properties: ['openDirectory'] as Array<'openDirectory'> }
    const result = window
      ? await dialog.showOpenDialog(window, options)
      : await dialog.showOpenDialog(options)
    return result.canceled ? null : (result.filePaths[0] ?? null)
  })

  ipcMain.handle(IPC_CHANNELS.SHELL_OPEN_PATH, async (_event, target: unknown) => {
    if (typeof target !== 'string' || !target.trim()) {
      throw new Error('A path is required.')
    }
    const resolved = resolve(target)
    const root = resolve(app.getPath('userData'))
    const reportsOk = resolved.toLowerCase().startsWith(root.toLowerCase())
    if (!reportsOk) {
      throw new Error('Only analysis folders saved by this app can be opened.')
    }
    return await shell.openPath(resolved)
  })
}
