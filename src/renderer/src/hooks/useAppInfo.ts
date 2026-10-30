import { useEffect, useState } from 'react'
import type { AppInfo } from '@shared/contracts/ipc'
import { getDesktopApi } from '../services/desktop-api'

export function useAppInfo() {
  const [info, setInfo] = useState<AppInfo | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const api = getDesktopApi()
    if (!api) {
      setError('The desktop API is unavailable outside the Electron shell.')
      return
    }

    let cancelled = false
    void api
      .getAppInfo()
      .then((next) => {
        if (!cancelled) {
          setInfo(next)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setError('Application information could not be loaded.')
        }
      })

    return () => {
      cancelled = true
    }
  }, [])

  return { info, error }
}
