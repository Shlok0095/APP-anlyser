import { existsSync, readFileSync, statSync } from 'node:fs'
import { basename, join } from 'node:path'
import yaml from 'js-yaml'
import { emptyAnalysisResult } from '../../shared/types/analysis'
import type { AnalysisEngineRuntime } from '../../shared/types/engine'
import { makeId } from '../base/ids'
import { findSecretFindings } from '../base/extract'

function parseDockerfile(text: string, result: ReturnType<typeof emptyAnalysisResult>): void {
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) {
      continue
    }
    const [instr, ...rest] = line.split(/\s+/)
    const value = rest.join(' ')
    if (instr.toUpperCase() === 'EXPOSE') {
      result.metadata[`expose:${value}`] = value
      result.components.push({ id: makeId('cmp'), kind: 'config', name: `EXPOSE ${value}` })
    }
    if (instr.toUpperCase() === 'USER' && value === 'root') {
      result.findings.push({
        id: makeId('find'),
        title: 'Container runs as root',
        severity: 'medium',
        category: 'container',
        evidence: [{ id: makeId('ev'), kind: 'line', snippet: line, note: 'Dockerfile USER' }],
        affected: 'Dockerfile',
        explanation:
          'The image declares USER root, which increases impact if the container is compromised.',
        confidence: 'high',
        remediation: 'Use a non-root USER.',
        engineId: 'container',
        falsePositiveNotes: 'Some build stages use root and later switch users.'
      })
    }
    if (instr.toUpperCase() === 'ENV' || instr.toUpperCase() === 'ARG') {
      result.components.push({ id: makeId('cmp'), kind: 'config', name: line.slice(0, 80) })
    }
    if (instr.toUpperCase() === 'FROM') {
      result.dependencies.push({ name: value, source: 'Dockerfile FROM' })
    }
  }
}

export const containerEngine: AnalysisEngineRuntime = {
  descriptor: {
    id: 'container',
    displayName: 'Docker and container inspection',
    version: '1.0.0',
    supportedPlatforms: ['win32', 'darwin', 'linux'],
    supportedTargetTypes: ['container'],
    supportedInputKinds: ['file', 'folder'],
    requiredUtilities: [],
    requiredPermissions: ['filesystem'],
    needsNetwork: false,
    involvesRuntime: false,
    capabilities: ['Dockerfile parse', 'Compose parse', 'secret scan']
  },
  validate(input) {
    const errors: string[] = []
    if (!input.path || !existsSync(input.path)) {
      errors.push('Select a Dockerfile, compose file, or folder.')
    }
    return {
      ok: errors.length === 0,
      errors,
      warnings: [
        'Images are never pulled or run without an explicit later action. This engine is static.'
      ]
    }
  },
  async execute(input, ctx) {
    const result = emptyAnalysisResult()
    if (!input.path) {
      throw new Error('Missing path.')
    }
    ctx.emitLog('Static container inspection only. No image pull or run.')
    const files: string[] = []
    if (statSync(input.path).isDirectory()) {
      files.push(
        join(input.path, 'Dockerfile'),
        join(input.path, 'docker-compose.yml'),
        join(input.path, 'compose.yaml')
      )
    } else {
      files.push(input.path)
    }
    for (const file of files) {
      if (!existsSync(file)) {
        continue
      }
      const text = readFileSync(file, 'utf8')
      result.files.push({ path: basename(file), size: text.length, kind: 'config' })
      result.findings.push(...findSecretFindings('container', basename(file), text))
      if (
        basename(file).toLowerCase().includes('docker') &&
        !file.endsWith('.yml') &&
        !file.endsWith('.yaml')
      ) {
        parseDockerfile(text, result)
      }
      if (file.endsWith('.yml') || file.endsWith('.yaml')) {
        try {
          const doc = yaml.load(text) as {
            services?: Record<string, { image?: string; privileged?: boolean; ports?: unknown }>
          }
          for (const [name, svc] of Object.entries(doc.services ?? {})) {
            result.components.push({
              id: makeId('cmp'),
              kind: 'module',
              name: `service:${name}`,
              detail: svc.image
            })
            if (svc.image) {
              result.dependencies.push({ name: svc.image, source: 'compose image' })
            }
            if (svc.privileged) {
              result.findings.push({
                id: makeId('find'),
                title: `Privileged compose service ${name}`,
                severity: 'high',
                category: 'container',
                evidence: [
                  { id: makeId('ev'), kind: 'file', path: basename(file), note: 'privileged: true' }
                ],
                affected: name,
                explanation: 'privileged mode removes most container isolation.',
                confidence: 'high',
                remediation: 'Drop privileged and grant only required capabilities.',
                engineId: 'container',
                falsePositiveNotes:
                  'Some device workflows still request privileged for hardware access.'
              })
            }
          }
        } catch {
          result.limitations.push(`${basename(file)} was not valid YAML.`)
        }
      }
    }
    return result
  }
}
