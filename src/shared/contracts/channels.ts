export const IPC_CHANNELS = {
  APP_GET_INFO: 'app:get-info',
  SETTINGS_GET: 'settings:get',
  SETTINGS_SET: 'settings:set',
  JOBS_LIST: 'jobs:list',
  JOBS_GET: 'jobs:get',
  JOBS_CREATE: 'jobs:create',
  JOBS_CANCEL: 'jobs:cancel',
  JOBS_DASHBOARD: 'jobs:dashboard',
  JOBS_READ_REPORT: 'jobs:read-report',
  JOBS_READ_EVIDENCE: 'jobs:read-evidence',
  ENGINES_LIST: 'engines:list',
  DIALOG_FILE: 'dialog:file',
  DIALOG_FOLDER: 'dialog:folder',
  DEVICES_LIST: 'devices:list',
  DEVICES_PACKAGES: 'devices:packages',
  SHELL_OPEN_PATH: 'shell:open-path'
} as const

export const IPC_EVENTS = {
  JOB: 'job:event'
} as const

export type IpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS]

export const IPC_CHANNEL_VALUES: IpcChannel[] = Object.values(IPC_CHANNELS)
