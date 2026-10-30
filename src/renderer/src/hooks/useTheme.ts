import { useCallback, useEffect, useState } from 'react'
import {
  DEFAULT_SETTINGS,
  type AppSettings,
  type SettingsPatch,
  type ThemePreference
} from '@shared/contracts/ipc'
import { getDesktopApi } from '../services/desktop-api'

function resolveTheme(theme: ThemePreference): 'dark' | 'light' {
  if (theme !== 'system') {
    return theme
  }
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
}

function applyTheme(theme: ThemePreference): void {
  document.documentElement.dataset.theme = resolveTheme(theme)
}

export function useTheme() {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS)
  const [error, setError] = useState<string | null>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const api = getDesktopApi()
    if (!api) {
      applyTheme('dark')
      setError('The desktop API is unavailable. Theme changes cannot be saved yet.')
      setReady(true)
      return
    }

    let cancelled = false
    void api
      .getSettings()
      .then((next) => {
        if (!cancelled) {
          setSettings(next)
          applyTheme(next.theme)
          setReady(true)
        }
      })
      .catch(() => {
        if (!cancelled) {
          applyTheme('dark')
          setError('Settings could not be loaded. Using the default dark theme.')
          setReady(true)
        }
      })

    return () => {
      cancelled = true
    }
  }, [])

  const updateTheme = useCallback(async (theme: ThemePreference) => {
    const api = getDesktopApi()
    applyTheme(theme)
    setSettings((current) => ({ ...current, theme }))
    if (!api) {
      setError('The desktop API is unavailable. Theme changes cannot be saved yet.')
      return
    }
    try {
      const next = await api.setSettings({ theme })
      setSettings(next)
      applyTheme(next.theme)
      setError(null)
    } catch {
      setError('The theme preference could not be saved.')
    }
  }, [])

  const saveSettings = useCallback(async (patch: SettingsPatch) => {
    const api = getDesktopApi()
    setSettings((current) => ({ ...current, ...patch }))
    if (!api) {
      setError('The desktop API is unavailable. Settings cannot be saved yet.')
      return
    }
    try {
      const next = await api.setSettings(patch)
      setSettings(next)
      applyTheme(next.theme)
      setError(null)
    } catch {
      setError('Settings could not be saved.')
    }
  }, [])

  return { settings, updateTheme, saveSettings, error, ready }
}
