import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, normalize, sep } from 'node:path'
import JSZip from 'jszip'

const MAX_FILES = 4000
const MAX_UNCOMPRESSED = 200 * 1024 * 1024

export interface ZipEntryInfo {
  name: string
  dir: boolean
  size: number
}

export async function listZip(buf: Buffer): Promise<ZipEntryInfo[]> {
  const zip = await JSZip.loadAsync(buf)
  const entries: ZipEntryInfo[] = []
  zip.forEach((name, file) => {
    entries.push({
      name: name.replaceAll('\\', '/'),
      dir: file.dir,
      size:
        (file as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize ?? 0
    })
  })
  return entries
}

export async function readZipText(
  buf: Buffer,
  name: string,
  maxBytes = 1_000_000
): Promise<string | null> {
  const zip = await JSZip.loadAsync(buf)
  const file = zip.file(name)
  if (!file) {
    return null
  }
  const text = await file.async('string')
  return text.slice(0, maxBytes)
}

export async function readZipBuffer(buf: Buffer, name: string): Promise<Buffer | null> {
  const zip = await JSZip.loadAsync(buf)
  const file = zip.file(name)
  if (!file) {
    return null
  }
  const data = await file.async('nodebuffer')
  return data
}

export function assertSafeZipPath(name: string): string {
  const normalized = normalize(name).replaceAll('\\', '/')
  if (normalized.startsWith('/') || normalized.includes('..') || /^[A-Za-z]:/.test(normalized)) {
    throw new Error(`Rejected unsafe archive path: ${name}`)
  }
  return normalized
}

export async function extractZipLimited(buf: Buffer, dest: string): Promise<string[]> {
  const zip = await JSZip.loadAsync(buf)
  const written: string[] = []
  let total = 0
  const files = Object.values(zip.files)
  if (files.length > MAX_FILES) {
    throw new Error(`Archive has ${files.length} entries, over the ${MAX_FILES} limit.`)
  }
  for (const file of files) {
    if (file.dir) {
      continue
    }
    const safe = assertSafeZipPath(file.name)
    const data = await file.async('nodebuffer')
    total += data.length
    if (total > MAX_UNCOMPRESSED) {
      throw new Error('Archive exceeds the uncompressed size limit.')
    }
    const abs = join(dest, safe.split('/').join(sep))
    mkdirSync(dirname(abs), { recursive: true })
    writeFileSync(abs, data)
    written.push(safe)
  }
  return written
}
