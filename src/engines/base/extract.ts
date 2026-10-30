import { createHash } from 'node:crypto'
import type { Evidence, Finding } from '../../shared/types/analysis'
import { makeId } from './ids'

const URL_RE = /https?:\/\/[^\s"'<>\\)]+/g
const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi
const SECRET_PATTERNS: Array<{ name: string; re: RegExp }> = [
  { name: 'AWS access key', re: /AKIA[0-9A-Z]{16}/g },
  { name: 'Private key block', re: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g },
  {
    name: 'Hardcoded password assignment',
    re: /(?:password|passwd|pwd)\s*[:=]\s*['"][^'"]{4,}['"]/gi
  },
  {
    name: 'Hardcoded API key assignment',
    re: /(?:api[_-]?key|secret[_-]?key)\s*[:=]\s*['"][^'"]{6,}['"]/gi
  }
]

export function extractUrls(text: string): string[] {
  return Array.from(new Set(text.match(URL_RE) ?? [])).slice(0, 200)
}

export function extractEmails(text: string): string[] {
  return Array.from(new Set(text.match(EMAIL_RE) ?? [])).slice(0, 50)
}

export function redact(value: string): string {
  if (value.length < 8) {
    return '***'
  }
  return `${value.slice(0, 3)}…${value.slice(-2)}`
}

export function findSecretFindings(engineId: string, path: string, text: string): Finding[] {
  const findings: Finding[] = []
  for (const pattern of SECRET_PATTERNS) {
    const matches = text.match(pattern.re)
    if (!matches) {
      continue
    }
    const evidence: Evidence = {
      id: makeId('ev'),
      kind: 'line',
      path,
      snippet: redact(matches[0]),
      note: `${pattern.name} matched in ${path}`
    }
    findings.push({
      id: makeId('find'),
      title: `${pattern.name} found in source`,
      severity: 'high',
      category: 'secrets',
      evidence: [evidence],
      affected: path,
      explanation: `A ${pattern.name.toLowerCase()} pattern was present in an accessible file. The value is redacted.`,
      confidence: 'medium',
      remediation:
        'Remove the secret, rotate it, and load it from a secret manager or environment at runtime.',
      engineId,
      falsePositiveNotes: 'Test fixtures and documentation examples can match these patterns.'
    })
  }
  return findings
}

export function sha256(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex')
}

export function extractPrintableStrings(buf: Buffer, minLength = 6): string[] {
  const out: string[] = []
  let current = ''
  for (const byte of buf) {
    if (byte >= 32 && byte <= 126) {
      current += String.fromCharCode(byte)
    } else {
      if (current.length >= minLength) {
        out.push(current)
      }
      current = ''
    }
  }
  if (current.length >= minLength) {
    out.push(current)
  }
  return out.slice(0, 4000)
}
