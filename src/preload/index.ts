import { contextBridge, ipcRenderer } from 'electron'
import { IPC_CHANNELS } from '../shared/contracts/channels'
import { IPC_EVENTS } from '../shared/contracts/channels'
import type { UaaDesktopApi } from '../shared/contracts/ipc'
import type { JobEvent } from '../shared/types/jobs'
import type { AnalysisInput } from '../shared/types/engine'

const api: UaaDesktopApi = {
  getAppInfo: () => ipcRenderer.invoke(IPC_CHANNELS.APP_GET_INFO),
  getSettings: () => ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_GET),
  setSettings: (patch) => ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_SET, patch),
  listJobs: () => ipcRenderer.invoke(IPC_CHANNELS.JOBS_LIST),
  getJob: (id) => ipcRenderer.invoke(IPC_CHANNELS.JOBS_GET, id),
  createJob: (input: AnalysisInput) => ipcRenderer.invoke(IPC_CHANNELS.JOBS_CREATE, input),
  cancelJob: (id) => ipcRenderer.invoke(IPC_CHANNELS.JOBS_CANCEL, id),
  getDashboard: () => ipcRenderer.invoke(IPC_CHANNELS.JOBS_DASHBOARD),
  listEngines: () => ipcRenderer.invoke(IPC_CHANNELS.ENGINES_LIST),
  pickFile: (filters) => ipcRenderer.invoke(IPC_CHANNELS.DIALOG_FILE, filters),
  pickFolder: () => ipcRenderer.invoke(IPC_CHANNELS.DIALOG_FOLDER),
  listDevices: () => ipcRenderer.invoke(IPC_CHANNELS.DEVICES_LIST),
  listDevicePackages: (deviceId) => ipcRenderer.invoke(IPC_CHANNELS.DEVICES_PACKAGES, deviceId),
  openPath: (target) => ipcRenderer.invoke(IPC_CHANNELS.SHELL_OPEN_PATH, target),
  readJobReport: (id) => ipcRenderer.invoke(IPC_CHANNELS.JOBS_READ_REPORT, id),
  readJobEvidence: (id) => ipcRenderer.invoke(IPC_CHANNELS.JOBS_READ_EVIDENCE, id),
  onJobEvent: (listener: (event: JobEvent) => void) => {
    const wrapped = (_event: unknown, payload: JobEvent): void => {
      listener(payload)
    }
    ipcRenderer.on(IPC_EVENTS.JOB, wrapped)
    return () => {
      ipcRenderer.removeListener(IPC_EVENTS.JOB, wrapped)
    }
  }
}

contextBridge.exposeInMainWorld('uaa', api)
