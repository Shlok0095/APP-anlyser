import type { UaaDesktopApi } from '../shared/contracts/ipc'

declare global {
  interface Window {
    uaa: UaaDesktopApi
  }
}

export {}
