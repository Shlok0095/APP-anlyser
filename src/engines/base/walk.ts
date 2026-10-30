import { readdirSync, readFileSync, statSync } from 'node:fs'
import { extname, join, relative } from 'node:path'

const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'out',
  'coverage',
  '__pycache__',
  '.venv',
  'venv',
  '.idea',
  '.vscode'
])

export interface WalkedFile {
  absPath: string
  relPath: string
  size: number
}

export function walkFiles(root: string, maxFiles = 2000): WalkedFile[] {
  const out: WalkedFile[] = []

  const visit = (dir: string): void => {
    if (out.length >= maxFiles) {
      return
    }
    let entries: string[] = []
    try {
      entries = readdirSync(dir)
    } catch {
      return
    }
    for (const entry of entries) {
      if (out.length >= maxFiles) {
        return
      }
      if (SKIP_DIRS.has(entry)) {
        continue
      }
      const abs = join(dir, entry)
      let stat
      try {
        stat = statSync(abs)
      } catch {
        continue
      }
      if (stat.isDirectory()) {
        visit(abs)
      } else if (stat.isFile()) {
        out.push({
          absPath: abs,
          relPath: relative(root, abs).replaceAll('\\', '/'),
          size: stat.size
        })
      }
    }
  }

  visit(root)
  return out
}

export function readTextFile(absPath: string, maxBytes = 1_000_000): string | null {
  try {
    const buf = readFileSync(absPath)
    if (buf.length > maxBytes) {
      return buf.subarray(0, maxBytes).toString('utf8')
    }
    if (buf.includes(0)) {
      return null
    }
    return buf.toString('utf8')
  } catch {
    return null
  }
}

export function extOf(path: string): string {
  return extname(path).toLowerCase()
}
