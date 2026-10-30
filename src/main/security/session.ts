import { shell, session, app } from 'electron'
import { is } from '@electron-toolkit/utils'
import { getContentSecurityPolicy } from './csp'

function isAllowedRendererNavigation(url: string): boolean {
  if (is.dev) {
    const rendererUrl = process.env.ELECTRON_RENDERER_URL
    if (rendererUrl && url.startsWith(rendererUrl)) {
      return true
    }
  }

  try {
    const parsed = new URL(url)
    return parsed.protocol === 'file:'
  } catch {
    return false
  }
}

function openExternalHttps(url: string): void {
  try {
    const parsed = new URL(url)
    if (parsed.protocol === 'https:') {
      void shell.openExternal(parsed.toString())
    }
  } catch {
    // Ignore malformed URLs rather than navigating in-app.
  }
}

export function hardenAppSession(): void {
  const csp = getContentSecurityPolicy(is.dev)

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [csp]
      }
    })
  })

  app.on('web-contents-created', (_event, contents) => {
    contents.on('will-navigate', (event, navigationUrl) => {
      if (!isAllowedRendererNavigation(navigationUrl)) {
        console.warn(`Blocked in-app navigation to ${navigationUrl}`)
        event.preventDefault()
      }
    })

    contents.setWindowOpenHandler(({ url }) => {
      openExternalHttps(url)
      return { action: 'deny' }
    })

    contents.on('will-attach-webview', (event) => {
      event.preventDefault()
    })
  })
}
