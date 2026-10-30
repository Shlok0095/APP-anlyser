import { useState } from 'react'
import type { AppSettings, ThemePreference } from '@shared/contracts/ipc'
import { NVIDIA_FALLBACK_MODEL, NVIDIA_PRIMARY_MODEL } from '@shared/nvidia'
import { PageHeader } from '../layouts/PageHeader'
import { useAppInfo } from '../hooks/useAppInfo'
import { useTheme } from '../hooks/useTheme'

const THEME_OPTIONS: Array<{ value: ThemePreference; label: string }> = [
  { value: 'dark', label: 'Dark' },
  { value: 'light', label: 'Light' },
  { value: 'system', label: 'System' }
]

function keyHint(saved: string): string {
  return saved ? `Saved key ending ${saved.slice(-4)}` : 'No key saved yet.'
}

export function SettingsPage() {
  const { settings, updateTheme, saveSettings, error: themeError, ready } = useTheme()
  const { info, error: infoError } = useAppInfo()
  const [nvidiaKey, setNvidiaKey] = useState('')
  const [openaiKey, setOpenaiKey] = useState('')
  const [anthropicKey, setAnthropicKey] = useState('')
  const [localKey, setLocalKey] = useState('')
  const [openaiBaseUrl, setOpenaiBaseUrl] = useState('')
  const [openaiModel, setOpenaiModel] = useState('')
  const [anthropicModel, setAnthropicModel] = useState('')
  const [localAiUrl, setLocalAiUrl] = useState('')
  const [nvidiaTouched, setNvidiaTouched] = useState(false)
  const [openaiTouched, setOpenaiTouched] = useState(false)
  const [anthropicTouched, setAnthropicTouched] = useState(false)
  const [localTouched, setLocalTouched] = useState(false)

  const saveProvider = (patch: Partial<AppSettings>, after?: () => void): void => {
    void saveSettings(patch).then(() => after?.())
  }

  return (
    <div className="settings-page">
      <PageHeader
        title="Settings and Privacy"
        description="Theme and optional AI keys stay in the local user data directory."
      />

      <div className="settings-panel">
        <section className="card">
          <h2>Appearance</h2>
          <p className="muted">Choose a color theme. The default is dark.</p>
          <div className="theme-row" role="group" aria-label="Theme">
            {THEME_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                className="theme-button"
                aria-pressed={settings.theme === option.value}
                disabled={!ready}
                onClick={() => {
                  void updateTheme(option.value)
                }}
              >
                {option.label}
              </button>
            ))}
          </div>
          {themeError ? (
            <p className="muted" role="status">
              {themeError}
            </p>
          ) : null}
        </section>

        <section className="card">
          <h2>Runtime</h2>
          {infoError ? (
            <p className="muted" role="status">
              {infoError}
            </p>
          ) : null}
          {info ? (
            <>
              <div className="kv-row">
                <span>Application</span>
                <strong>
                  {info.name} {info.version}
                </strong>
              </div>
              <div className="kv-row">
                <span>Electron</span>
                <strong>{info.electronVersion}</strong>
              </div>
              <div className="kv-row">
                <span>Chrome</span>
                <strong>{info.chromeVersion}</strong>
              </div>
              <div className="kv-row">
                <span>Node</span>
                <strong>{info.nodeVersion}</strong>
              </div>
              <div className="kv-row">
                <span>Platform</span>
                <strong>
                  {info.platform} / {info.arch}
                </strong>
              </div>
            </>
          ) : !infoError ? (
            <p className="muted">Loading application information…</p>
          ) : null}
        </section>

        <section className="card">
          <h2>Analysis backend</h2>
          <p>
            Static and package inspection is driven by REA (morluto/rea) through the local CLI{' '}
            <code>rea-agents@6.8.0</code>. UAA maps REA Evidence into this window.
          </p>
          <p className="muted">
            Prefer a <code>rea</code> binary on PATH. Otherwise Node.js plus{' '}
            <code>npx -y rea-agents@6.8.0</code> is used. Android APK decompilation needs JDK 17+ and
            JADX. Native EXE/ELF decompilation needs Ghidra on PATH. ELF layout needs pwntools. WASM
            inspection needs WABT. Bare website URLs need a CDP browser.
          </p>
        </section>

        <section className="card">
          <h2>Providers</h2>
          <p>
            After each analysis, UAA writes one long Markdown file. If a key is saved, that file is
            structured for Cursor / Claude Code. Order: NVIDIA NIM, then OpenAI-compatible.
            Anthropic and local endpoints are stored here for later adapters.
          </p>
          <p className="muted">
            Keys stay in this app&apos;s user data folder. They are never written into reports or
            git. Analysis still runs locally if no key is saved.
          </p>

          <div className="provider-row">
            <h3>NVIDIA NIM</h3>
            <p className="muted">build.nvidia.com · used first for report structuring</p>
            <label className="muted" htmlFor="nvidia-key">
              API key
            </label>
            <input
              id="nvidia-key"
              className="text-input"
              type="password"
              autoComplete="off"
              placeholder={settings.nvidiaApiKey ? 'Key saved — paste a new key to replace it' : 'nvapi-...'}
              value={nvidiaTouched ? nvidiaKey : ''}
              onChange={(event) => {
                setNvidiaTouched(true)
                setNvidiaKey(event.target.value)
              }}
            />
            <p className="muted">{keyHint(settings.nvidiaApiKey)}</p>
            <label className="muted" htmlFor="nvidia-model">
              Model
            </label>
            <select
              id="nvidia-model"
              className="text-input"
              value={settings.nvidiaModel}
              disabled={!ready}
              onChange={(event) => {
                void saveSettings({ nvidiaModel: event.target.value })
              }}
            >
              <option value={NVIDIA_PRIMARY_MODEL}>
                {NVIDIA_PRIMARY_MODEL} (1M context, recommended)
              </option>
              <option value={NVIDIA_FALLBACK_MODEL}>{NVIDIA_FALLBACK_MODEL} (faster fallback)</option>
            </select>
            <div className="theme-row">
              <button
                type="button"
                className="button primary"
                disabled={!ready || !nvidiaTouched || !nvidiaKey.trim()}
                onClick={() => {
                  saveProvider({ nvidiaApiKey: nvidiaKey.trim() }, () => {
                    setNvidiaTouched(false)
                    setNvidiaKey('')
                  })
                }}
              >
                Save NVIDIA key
              </button>
            </div>
          </div>

          <div className="provider-row">
            <h3>OpenAI-compatible</h3>
            <p className="muted">Used if NVIDIA is missing or fails. Same chat/completions shape.</p>
            <label className="muted" htmlFor="openai-key">
              API key
            </label>
            <input
              id="openai-key"
              className="text-input"
              type="password"
              autoComplete="off"
              placeholder={settings.openaiApiKey ? 'Key saved — paste a new key to replace it' : 'sk-...'}
              value={openaiTouched ? openaiKey : ''}
              onChange={(event) => {
                setOpenaiTouched(true)
                setOpenaiKey(event.target.value)
              }}
            />
            <p className="muted">{keyHint(settings.openaiApiKey)}</p>
            <label className="muted" htmlFor="openai-base">
              Base URL
            </label>
            <input
              id="openai-base"
              className="text-input"
              type="url"
              autoComplete="off"
              placeholder={settings.openaiBaseUrl}
              value={openaiBaseUrl}
              onChange={(event) => setOpenaiBaseUrl(event.target.value)}
            />
            <label className="muted" htmlFor="openai-model">
              Model
            </label>
            <input
              id="openai-model"
              className="text-input"
              autoComplete="off"
              placeholder={settings.openaiModel}
              value={openaiModel}
              onChange={(event) => setOpenaiModel(event.target.value)}
            />
            <div className="theme-row">
              <button
                type="button"
                className="button primary"
                disabled={!ready}
                onClick={() => {
                  saveProvider(
                    {
                      ...(openaiTouched && openaiKey.trim() ? { openaiApiKey: openaiKey.trim() } : {}),
                      openaiBaseUrl: openaiBaseUrl.trim() || settings.openaiBaseUrl,
                      openaiModel: openaiModel.trim() || settings.openaiModel
                    },
                    () => {
                      setOpenaiTouched(false)
                      setOpenaiKey('')
                    }
                  )
                }}
              >
                Save OpenAI settings
              </button>
            </div>
          </div>

          <div className="provider-row">
            <h3>Anthropic</h3>
            <p className="muted">Stored locally. Not used for the long Markdown pass yet.</p>
            <label className="muted" htmlFor="anthropic-key">
              API key
            </label>
            <input
              id="anthropic-key"
              className="text-input"
              type="password"
              autoComplete="off"
              placeholder={
                settings.anthropicApiKey ? 'Key saved — paste a new key to replace it' : 'sk-ant-...'
              }
              value={anthropicTouched ? anthropicKey : ''}
              onChange={(event) => {
                setAnthropicTouched(true)
                setAnthropicKey(event.target.value)
              }}
            />
            <p className="muted">{keyHint(settings.anthropicApiKey)}</p>
            <label className="muted" htmlFor="anthropic-model">
              Model
            </label>
            <input
              id="anthropic-model"
              className="text-input"
              autoComplete="off"
              placeholder={settings.anthropicModel}
              value={anthropicModel}
              onChange={(event) => setAnthropicModel(event.target.value)}
            />
            <div className="theme-row">
              <button
                type="button"
                className="button primary"
                disabled={!ready}
                onClick={() => {
                  saveProvider(
                    {
                      ...(anthropicTouched && anthropicKey.trim()
                        ? { anthropicApiKey: anthropicKey.trim() }
                        : {}),
                      anthropicModel: anthropicModel.trim() || settings.anthropicModel
                    },
                    () => {
                      setAnthropicTouched(false)
                      setAnthropicKey('')
                    }
                  )
                }}
              >
                Save Anthropic settings
              </button>
            </div>
          </div>

          <div className="provider-row">
            <h3>Local</h3>
            <p className="muted">Optional local endpoint plus key. Not used for the long Markdown pass yet.</p>
            <label className="muted" htmlFor="local-url">
              Endpoint
            </label>
            <input
              id="local-url"
              className="text-input"
              type="url"
              autoComplete="off"
              placeholder={settings.localAiUrl}
              value={localAiUrl}
              onChange={(event) => setLocalAiUrl(event.target.value)}
            />
            <label className="muted" htmlFor="local-key">
              Optional key
            </label>
            <input
              id="local-key"
              className="text-input"
              type="password"
              autoComplete="off"
              placeholder={settings.localAiKey ? 'Key saved — paste a new key to replace it' : 'optional'}
              value={localTouched ? localKey : ''}
              onChange={(event) => {
                setLocalTouched(true)
                setLocalKey(event.target.value)
              }}
            />
            <p className="muted">{keyHint(settings.localAiKey)}</p>
            <p className="muted">Mode: {settings.aiMode}</p>
            <div className="theme-row">
              <button
                type="button"
                className="button primary"
                disabled={!ready}
                onClick={() => {
                  saveProvider(
                    {
                      localAiUrl: localAiUrl.trim() || settings.localAiUrl,
                      ...(localTouched && localKey.trim() ? { localAiKey: localKey.trim() } : {})
                    },
                    () => {
                      setLocalTouched(false)
                      setLocalKey('')
                    }
                  )
                }}
              >
                Save local settings
              </button>
            </div>
          </div>
        </section>

        <section className="card">
          <h2>Privacy</h2>
          <p>
            Analysis stays on this device by default. Network is used for Play Store metadata, a
            remote URL, or report structuring when you save a key.
          </p>
          <p className="muted">API keys stay in local settings. Reports redact key-shaped strings.</p>
        </section>
      </div>
    </div>
  )
}
