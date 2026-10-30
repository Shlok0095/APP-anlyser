import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { JobRecord } from '../../shared/types/jobs'
import { compileReconstructionMarkdown, redactSecrets } from './full-markdown'

const COPY_LIMIT_BYTES = 512 * 1024 * 1024

export interface EvidencePackPaths {
  evidenceFolder: string
  reconstruction: string
  evidence?: string
}

function copyReaJson(workspace: string, folder: string): string[] {
  const copied: string[] = []
  if (!existsSync(workspace)) {
    return copied
  }
  let names: string[] = []
  try {
    names = readdirSync(workspace).filter((name) => name.startsWith('rea-') && name.endsWith('.json'))
  } catch {
    return copied
  }
  for (const name of names.sort()) {
    const src = join(workspace, name)
    const dest = join(folder, name)
    try {
      const size = statSync(src).size
      if (size > COPY_LIMIT_BYTES) {
        writeFileSync(
          `${dest}.pointer.txt`,
          `Original: ${src}\nBytes: ${size}\nNot copied because the Evidence file is larger than 512 MiB.\n`,
          'utf8'
        )
        copied.push(`${name}.pointer.txt`)
        continue
      }
      copyFileSync(src, dest)
      copied.push(name)
    } catch {
      continue
    }
  }
  return copied
}

function compileIndex(job: JobRecord, copied: string[]): string {
  const lines = [
    '# REA evidence pack',
    '',
    `Target: ${job.targetLabel}`,
    `Process: ${job.id}`,
    '',
    'This folder is saved separately from the process report. Hand `reconstruction.md` and the JSON files here to Cursor or Claude Code to build a similar app from observed evidence.',
    '',
    'Do not invent files, APIs, or secrets. Missing items are unknown. Do not execute the original binary.',
    '',
    '## Files',
    '',
    '- `reconstruction.md` — rebuild spec (modules, routes, imports, files, unknowns)',
    ...copied.map((name) => `- \`${name}\``),
    ''
  ]
  return redactSecrets(lines.join('\n'))
}

export function writeEvidencePack(job: JobRecord, reportsDir: string): EvidencePackPaths {
  const folder = join(reportsDir, 'evidence')
  mkdirSync(folder, { recursive: true })
  const workspace = job.result?.metadata.reaWorkspaceDir
  const copied = workspace ? copyReaJson(workspace, folder) : []
  const reconstruction = join(folder, 'reconstruction.md')
  writeFileSync(reconstruction, compileReconstructionMarkdown(job, folder), 'utf8')
  writeFileSync(join(folder, 'INDEX.md'), compileIndex(job, copied), 'utf8')
  const primary =
    copied.find((name) => name.includes('analyze') && name.endsWith('.json')) ??
    copied.find((name) => name.endsWith('.json'))
  return {
    evidenceFolder: folder,
    reconstruction,
    evidence: primary
      ? join(folder, primary)
      : job.result?.metadata.reaEvidencePath ?? job.result?.metadata.reaJsonPath
  }
}
