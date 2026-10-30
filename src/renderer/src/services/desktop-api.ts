import type { UaaDesktopApi } from '@shared/contracts/ipc'

export function getDesktopApi(): UaaDesktopApi | null {
  if (typeof window === 'undefined' || !window.uaa) {
    return null
  }
  return window.uaa
}
