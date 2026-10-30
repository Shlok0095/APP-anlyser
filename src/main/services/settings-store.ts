import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import {
  appSettingsSchema,
  DEFAULT_SETTINGS,
  settingsPatchSchema,
  type AppSettings,
  type SettingsPatch
} from '../../shared/contracts/ipc'

export class SettingsStore {
  constructor(private readonly filePath: string) {}

  read(): AppSettings {
    if (!existsSync(this.filePath)) {
      return { ...DEFAULT_SETTINGS }
    }

    try {
      const raw = readFileSync(this.filePath, 'utf8')
      const parsed: unknown = JSON.parse(raw)
      return coerceSettings(parsed)
    } catch {
      return { ...DEFAULT_SETTINGS }
    }
  }

  write(patch: SettingsPatch): AppSettings {
    const parsedPatch = settingsPatchSchema.parse(patch)
    const next = appSettingsSchema.parse({
      ...this.read(),
      ...parsedPatch
    })
    mkdirSync(dirname(this.filePath), { recursive: true })
    writeFileSync(this.filePath, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
    return next
  }
}

function coerceSettings(raw: unknown): AppSettings {
  if (!raw || typeof raw !== 'object') {
    return { ...DEFAULT_SETTINGS }
  }
  const rec = raw as Record<string, unknown>
  const picked: Record<string, unknown> = { ...DEFAULT_SETTINGS }
  for (const key of Object.keys(DEFAULT_SETTINGS) as Array<keyof AppSettings>) {
    if (key in rec) {
      picked[key] = rec[key]
    }
  }
  const result = appSettingsSchema.safeParse(picked)
  return result.success ? result.data : { ...DEFAULT_SETTINGS }
}
