import { emptyAnalysisResult } from '../../shared/types/analysis'
import type { AnalysisEngineRuntime } from '../../shared/types/engine'
import { makeId } from '../base/ids'
import * as cheerio from 'cheerio'

const PACKAGE_RE = /^[a-zA-Z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/
const PLAY_RE = /^https:\/\/play\.google\.com\/store\/apps\/details\?/i

export function parsePlayPackage(input: string): string | null {
  if (PACKAGE_RE.test(input)) {
    return input
  }
  try {
    const url = new URL(input)
    if (url.hostname !== 'play.google.com') {
      return null
    }
    return url.searchParams.get('id')
  } catch {
    return null
  }
}

export const playStoreEngine: AnalysisEngineRuntime = {
  descriptor: {
    id: 'android-play',
    displayName: 'Play Store metadata lookup',
    version: '1.0.0',
    supportedPlatforms: ['win32', 'darwin', 'linux'],
    supportedTargetTypes: ['android'],
    supportedInputKinds: ['url', 'package-name'],
    requiredUtilities: [],
    requiredPermissions: ['network'],
    needsNetwork: true,
    involvesRuntime: false,
    capabilities: ['public listing metadata']
  },
  validate(input) {
    const errors: string[] = []
    const warnings: string[] = []
    const raw = input.url ?? input.packageName ?? ''
    if (!raw) {
      errors.push('A Play Store URL or package name is required.')
    } else if (!parsePlayPackage(raw) && !(input.url && PLAY_RE.test(input.url))) {
      errors.push('Provide a package name like com.example.app or a play.google.com details URL.')
    }
    if (!input.profile.allowNetwork) {
      errors.push('Play Store lookup needs explicit network permission in the analysis profile.')
    }
    warnings.push(
      'A Play Store URL does not provide source code or private app data. Only public listing metadata is fetched.'
    )
    return { ok: errors.length === 0, errors, warnings }
  },
  async execute(input, ctx) {
    const result = emptyAnalysisResult()
    const pkg = parsePlayPackage(input.url ?? input.packageName ?? '') ?? ''
    result.metadata.packageName = pkg
    result.metadata.source = 'Google Play public listing'
    const url = `https://play.google.com/store/apps/details?id=${encodeURIComponent(pkg)}&hl=en&gl=US`
    ctx.emitLog(`Fetching public listing ${url}`)
    const html = await ctx.fetchText(url)
    const $ = cheerio.load(html)
    const title =
      $('h1').first().text().trim() || $('meta[property="og:title"]').attr('content') || ''
    const description =
      $('meta[name="description"]').attr('content') ||
      $('meta[property="og:description"]').attr('content') ||
      ''
    result.metadata.appName = title || 'unavailable'
    result.metadata.description = description.slice(0, 2000)
    result.metadata.provenance = 'public-html'
    result.components.push({
      id: makeId('cmp'),
      kind: 'module',
      name: title || pkg,
      detail: 'Public Play Store listing'
    })
    result.limitations.push(
      'No APK was downloaded. Deeper analysis requires an authorized APK or a connected device.'
    )
    if (!title) {
      result.skipped.push({
        check: 'listing parse',
        reason: 'The public page did not expose a title with the current parser.'
      })
    }
    return result
  }
}
