import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '../../src/shared/contracts/ipc'
import { SettingsStore } from '../../src/main/services/settings-store'

function tempSettingsPath(): string {
  return join(mkdtempSync(join(tmpdir(), 'uaa-settings-')), 'settings.json')
}

describe('SettingsStore', () => {
  it('returns defaults when the file does not exist', () => {
    const store = new SettingsStore(tempSettingsPath())
    expect(store.read()).toEqual(DEFAULT_SETTINGS)
  })

  it('persists a valid theme patch', () => {
    const filePath = tempSettingsPath()
    const store = new SettingsStore(filePath)
    const saved = store.write({ theme: 'light' })
    expect(saved.theme).toBe('light')
    expect(JSON.parse(readFileSync(filePath, 'utf8')).theme).toBe('light')
  })

  it('returns defaults when the file is invalid JSON', () => {
    const filePath = tempSettingsPath()
    writeFileSync(filePath, '{not json', 'utf8')
    const store = new SettingsStore(filePath)
    expect(store.read()).toEqual(DEFAULT_SETTINGS)
  })

  it('rejects an invalid patch', () => {
    const store = new SettingsStore(tempSettingsPath())
    expect(() => store.write({ theme: 'purple' } as never)).toThrow()
  })

  it('keeps an existing NVIDIA key when newer provider fields are missing', () => {
    const filePath = tempSettingsPath()
    writeFileSync(
      filePath,
      JSON.stringify({
        theme: 'dark',
        aiMode: 'off',
        localAiUrl: 'http://127.0.0.1:11434/api/generate',
        nvidiaApiKey: 'nvapi-legacy',
        nvidiaModel: 'nvidia/nemotron-3-ultra-550b-a55b'
      }),
      'utf8'
    )
    const store = new SettingsStore(filePath)
    const settings = store.read()
    expect(settings.nvidiaApiKey).toBe('nvapi-legacy')
    expect(settings.openaiApiKey).toBe('')
    expect(settings.openaiBaseUrl).toBe('https://api.openai.com/v1')
  })
})
