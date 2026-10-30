import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SETTINGS,
  IPC_CHANNEL_VALUES,
  IPC_CHANNELS,
  analysisInputSchema,
  appSettingsSchema,
  settingsPatchSchema
} from '../../src/shared/contracts/ipc'
import { DEFAULT_PROFILE } from '../../src/shared/types/engine'

describe('IPC contracts', () => {
  it('exposes a unique allowlist of channels', () => {
    expect(IPC_CHANNEL_VALUES).toContain(IPC_CHANNELS.APP_GET_INFO)
    expect(IPC_CHANNEL_VALUES).toContain(IPC_CHANNELS.JOBS_CREATE)
    expect(new Set(IPC_CHANNEL_VALUES).size).toBe(IPC_CHANNEL_VALUES.length)
  })

  it('accepts the default settings object', () => {
    expect(appSettingsSchema.parse(DEFAULT_SETTINGS)).toMatchObject({
      theme: 'dark',
      aiMode: 'off',
      openaiBaseUrl: 'https://api.openai.com/v1',
      anthropicModel: 'claude-sonnet-4-5',
      localAiKey: ''
    })
  })

  it('rejects unknown settings keys', () => {
    const result = appSettingsSchema.safeParse({ theme: 'dark', extra: true })
    expect(result.success).toBe(false)
  })

  it('accepts a theme patch and rejects invalid values', () => {
    expect(settingsPatchSchema.parse({ theme: 'light' })).toEqual({ theme: 'light' })
    expect(settingsPatchSchema.safeParse({ theme: 'purple' }).success).toBe(false)
  })

  it('rejects analysis jobs that omit the target path', () => {
    const result = analysisInputSchema.safeParse({
      targetType: 'android',
      inputKind: 'file',
      label: 'android',
      profile: DEFAULT_PROFILE
    })
    expect(result.success).toBe(false)
  })
})
