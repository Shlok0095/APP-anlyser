import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import * as cheerio from 'cheerio'
import { emptyAnalysisResult } from '../../shared/types/analysis'
import type { AnalysisEngineRuntime } from '../../shared/types/engine'
import { makeId } from '../base/ids'
import { extractUrls } from '../base/extract'
import { readTextFile, walkFiles } from '../base/walk'
import { findOnPath } from '../base/spawn'

function inspectHtml(pathLabel: string, html: string, source: 'source' | 'runtime') {
  const $ = cheerio.load(html)
  const title = $('title').text().trim()
  const forms = $('form')
    .toArray()
    .map((form, index) => ({
      id: makeId('cmp'),
      kind: 'form' as const,
      name: $(form).attr('action') || `form-${index + 1}`,
      path: pathLabel,
      detail: `method=${($(form).attr('method') || 'get').toUpperCase()}`
    }))
  const pages = [
    {
      id: makeId('cmp'),
      kind: 'page' as const,
      name: title || pathLabel,
      path: pathLabel
    }
  ]
  const endpoints = extractUrls(html).map((url) => ({
    id: makeId('ep'),
    url,
    source,
    evidence: [
      {
        id: makeId('ev'),
        kind: 'file' as const,
        path: pathLabel,
        snippet: url,
        note: 'HTML literal'
      }
    ]
  }))
  const scripts = $('script[src]')
    .toArray()
    .map((el) => $(el).attr('src'))
    .filter((src): src is string => Boolean(src))
  return { title, forms, pages, endpoints, scripts }
}

export const webEngine: AnalysisEngineRuntime = {
  descriptor: {
    id: 'web-static',
    displayName: 'Website and web-app inspection',
    version: '1.0.0',
    supportedPlatforms: ['win32', 'darwin', 'linux'],
    supportedTargetTypes: ['website'],
    supportedInputKinds: ['url', 'folder', 'file'],
    requiredUtilities: [],
    requiredPermissions: ['filesystem'],
    needsNetwork: true,
    involvesRuntime: false,
    capabilities: ['HTML parse', 'form inventory', 'optional Playwright']
  },
  validate(input) {
    const errors: string[] = []
    if (input.inputKind === 'url') {
      try {
        const url = new URL(input.url ?? '')
        if (!['http:', 'https:'].includes(url.protocol)) {
          errors.push('Only http and https URLs are allowed.')
        }
      } catch {
        errors.push('Enter a valid URL.')
      }
      if (!input.profile.allowNetwork && (input.url ?? '').startsWith('https://')) {
        errors.push('Fetching a remote URL requires allowing network access in the profile.')
      }
    } else if (!input.path || !existsSync(input.path)) {
      errors.push('A local HTML file or frontend folder is required.')
    }
    return {
      ok: errors.length === 0,
      errors,
      warnings: ['Passwords, cookies, and tokens are not stored in reports.']
    }
  },
  async execute(input, ctx) {
    const result = emptyAnalysisResult()
    if (input.inputKind === 'url' && input.url) {
      const local =
        input.url.startsWith('file:') ||
        input.url.startsWith('http://127.0.0.1') ||
        input.url.startsWith('http://localhost')
      if (!local && !input.profile.allowNetwork) {
        throw new Error('Remote fetch blocked.')
      }
      ctx.emitLog(`Fetching ${input.url}`)
      const html = await ctx.fetchText(input.url)
      const inspected = inspectHtml(input.url, html, 'source')
      result.metadata.title = inspected.title
      result.metadata.url = input.url
      result.components.push(...inspected.pages, ...inspected.forms)
      result.endpoints.push(...inspected.endpoints)
      result.metadata.scripts = inspected.scripts.slice(0, 30).join(', ')
    } else if (input.path) {
      const stat = statSync(input.path)
      const files = stat.isDirectory()
        ? walkFiles(input.path).filter(
            (f) => f.relPath.endsWith('.html') || f.relPath.endsWith('.htm')
          )
        : [{ absPath: input.path, relPath: input.path, size: stat.size }]
      result.metadata.pageCount = String(files.length)
      for (const file of files.slice(0, 50)) {
        const html = readTextFile(file.absPath)
        if (!html) {
          continue
        }
        const inspected = inspectHtml(file.relPath, html, 'source')
        result.components.push(...inspected.pages, ...inspected.forms)
        result.endpoints.push(...inspected.endpoints)
      }
    }

    const playwright = findOnPath('playwright')
    if (input.profile.runtime && playwright && input.url) {
      result.skipped.push({
        check: 'playwright session',
        reason:
          'Playwright is present, but live browser sessions are not auto-started. Use an explicit runtime session later if needed.'
      })
    } else if (input.profile.runtime && !playwright) {
      result.skipped.push({ check: 'playwright', reason: 'Playwright is not installed.' })
    }
    result.limitations.push('No CAPTCHA, authentication wall, or rate limit was bypassed.')
    return result
  }
}

export function readLocalHtml(path: string): string {
  return readFileSync(join(path), 'utf8')
}
