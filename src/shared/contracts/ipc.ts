import { z } from 'zod'
import type { AnalysisEngine, AnalysisInput } from '../types/engine'
import type { DashboardSnapshot, JobEvent, JobRecord } from '../types/jobs'
import { missingAnalysisTarget } from '../validation/input'
import { NVIDIA_PRIMARY_MODEL } from '../nvidia'

export interface AdbDeviceInfo {
  id: string
  status: string
  extras: string
}

export { IPC_CHANNELS, IPC_CHANNEL_VALUES, type IpcChannel } from './channels'

export const themePreferenceSchema = z.enum(['dark', 'light', 'system'])

export type ThemePreference = z.infer<typeof themePreferenceSchema>

export const appSettingsSchema = z
  .object({
    theme: themePreferenceSchema,
    aiMode: z.enum(['off', 'local', 'cloud']).default('off'),
    localAiUrl: z.string().default('http://127.0.0.1:11434/api/generate'),
    nvidiaApiKey: z.string().default(''),
    nvidiaModel: z.string().default(NVIDIA_PRIMARY_MODEL),
    openaiApiKey: z.string().default(''),
    openaiBaseUrl: z.string().default('https://api.openai.com/v1'),
    openaiModel: z.string().default('gpt-4.1'),
    anthropicApiKey: z.string().default(''),
    anthropicModel: z.string().default('claude-sonnet-4-5'),
    localAiKey: z.string().default('')
  })
  .strict()

export type AppSettings = z.infer<typeof appSettingsSchema>

export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'dark',
  aiMode: 'off',
  localAiUrl: 'http://127.0.0.1:11434/api/generate',
  nvidiaApiKey: '',
  nvidiaModel: NVIDIA_PRIMARY_MODEL,
  openaiApiKey: '',
  openaiBaseUrl: 'https://api.openai.com/v1',
  openaiModel: 'gpt-4.1',
  anthropicApiKey: '',
  anthropicModel: 'claude-sonnet-4-5',
  localAiKey: ''
}

export const settingsPatchSchema = appSettingsSchema.partial().strict()

export type SettingsPatch = z.infer<typeof settingsPatchSchema>

export const appInfoSchema = z
  .object({
    name: z.string(),
    version: z.string(),
    electronVersion: z.string(),
    chromeVersion: z.string(),
    nodeVersion: z.string(),
    platform: z.string(),
    arch: z.string()
  })
  .strict()

export type AppInfo = z.infer<typeof appInfoSchema>

export const analysisProfileSchema = z.object({
  basic: z.boolean(),
  architecture: z.boolean(),
  dependencies: z.boolean(),
  security: z.boolean(),
  api: z.boolean(),
  runtime: z.boolean(),
  ai: z.boolean(),
  allowNetwork: z.boolean()
})

export const analysisInputSchema = z
  .object({
    targetType: z.enum([
      'android',
      'windows',
      'macos',
      'linux',
      'website',
      'source',
      'package',
      'container',
      'archive',
      'tool'
    ]),
    inputKind: z.enum(['file', 'folder', 'url', 'package-name', 'device-package']),
    label: z.string().min(1),
    path: z.string().optional(),
    url: z.string().optional(),
    packageName: z.string().optional(),
    deviceId: z.string().optional(),
    profile: analysisProfileSchema
  })
  .superRefine((value, ctx) => {
    const missing = missingAnalysisTarget(value)
    if (missing) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: missing })
    }
  })

export interface UaaDesktopApi {
  getAppInfo: () => Promise<AppInfo>
  getSettings: () => Promise<AppSettings>
  setSettings: (patch: SettingsPatch) => Promise<AppSettings>
  listJobs: () => Promise<JobRecord[]>
  getJob: (id: string) => Promise<JobRecord | null>
  createJob: (input: AnalysisInput) => Promise<JobRecord>
  cancelJob: (id: string) => Promise<JobRecord | null>
  getDashboard: () => Promise<DashboardSnapshot>
  listEngines: () => Promise<AnalysisEngine[]>
  pickFile: (filters?: Array<{ name: string; extensions: string[] }>) => Promise<string | null>
  pickFolder: () => Promise<string | null>
  listDevices: () => Promise<AdbDeviceInfo[]>
  listDevicePackages: (deviceId: string) => Promise<string[]>
  openPath: (target: string) => Promise<string>
  readJobReport: (id: string) => Promise<{ path: string; content: string } | null>
  readJobEvidence: (
    id: string
  ) => Promise<{ path: string; content: string; folder: string } | null>
  onJobEvent: (listener: (event: JobEvent) => void) => () => void
}
