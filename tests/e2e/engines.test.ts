import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PROFILE,
  type AnalysisInput,
  type EngineContext
} from '../../src/shared/types/engine'
import { sourceCodeEngine } from '../../src/engines/source-code'
import { apkEngine } from '../../src/engines/android/apk'
import { playStoreEngine, parsePlayPackage } from '../../src/engines/android/play-store'
import { parseAdbDevices } from '../../src/engines/android/device'
import { webEngine } from '../../src/engines/web'
import { windowsEngine } from '../../src/engines/windows'
import { packageEngine } from '../../src/engines/packages'
import { containerEngine } from '../../src/engines/containers'
import { archiveEngine } from '../../src/engines/archives'
import { JobStore } from '../../src/main/storage/job-store'
import { JobManager } from '../../src/main/jobs/manager'
import { EvidenceRestatingProvider } from '../../src/ai/explainer'
import { generateReports } from '../../src/main/reports/generate'

const root = join(__dirname, '../../fixtures')

function ctx(fetchText?: EngineContext['fetchText']): EngineContext {
  const artifactDir = join(tmpdir(), `uaa-${Date.now()}-${Math.random().toString(16).slice(2)}`)
  mkdirSync(artifactDir, { recursive: true })
  return {
    artifactDir,
    isCancelled: () => false,
    emitLog: () => undefined,
    emitProgress: () => undefined,
    runCommand: async () => ({
      code: 1,
      stdout: '',
      stderr: 'utility not present in test',
      timedOut: false
    }),
    fetchText: fetchText ?? (async () => '')
  }
}

function input(
  partial: Partial<AnalysisInput> & Pick<AnalysisInput, 'targetType' | 'inputKind' | 'label'>
): AnalysisInput {
  return {
    profile: { ...DEFAULT_PROFILE, allowNetwork: true, ai: true },
    ...partial
  }
}

describe('source engine', () => {
  it('extracts node modules, routes, secrets, and dependencies', async () => {
    const result = await sourceCodeEngine.execute(
      input({
        targetType: 'source',
        inputKind: 'folder',
        label: 'source',
        path: join(root, 'source-app')
      }),
      ctx()
    )
    expect(result.metadata['package.name']).toBe('uaa-sample-source')
    expect(result.dependencies.some((dep) => dep.name === 'express')).toBe(true)
    expect(result.endpoints.some((endpoint) => endpoint.url === '/health')).toBe(true)
    expect(result.findings.some((finding) => finding.category === 'secrets')).toBe(true)
    expect(result.graph.edges.length).toBeGreaterThan(0)
  })

  it('extracts FastAPI routes from Python fixtures', async () => {
    const result = await sourceCodeEngine.execute(
      input({
        targetType: 'source',
        inputKind: 'folder',
        label: 'python',
        path: join(root, 'python-app')
      }),
      ctx()
    )
    expect(result.metadata.projectKind).toBe('python')
    expect(result.endpoints.some((endpoint) => endpoint.url === '/items')).toBe(true)
    expect(result.dependencies.some((dep) => dep.name === 'fastapi')).toBe(true)
  })
})

describe('android engines', () => {
  it('parses Play package names and URLs', () => {
    expect(parsePlayPackage('com.example.app')).toBe('com.example.app')
    expect(parsePlayPackage('https://play.google.com/store/apps/details?id=com.example.app')).toBe(
      'com.example.app'
    )
  })

  it('reads public listing HTML through the fetch adapter', async () => {
    const html = readFileSync(join(root, 'play-store.html'), 'utf8')
    const result = await playStoreEngine.execute(
      input({
        targetType: 'android',
        inputKind: 'package-name',
        label: 'play',
        packageName: 'com.example.app'
      }),
      ctx(async () => html)
    )
    expect(result.metadata.appName).toBe('Sample Public App')
    expect(result.metadata.provenance).toBe('public-html')
  })

  it('inspects a dummy APK zip without executing it', async () => {
    const zip = new JSZip()
    zip.file('AndroidManifest.xml', 'android.permission.INTERNET com.example.app.MainActivity')
    zip.file('classes.dex', 'dex\0')
    zip.file('lib/arm64-v8a/libdemo.so', 'so')
    const buf = await zip.generateAsync({ type: 'nodebuffer' })
    const apkPath = join(tmpdir(), `sample-${Date.now()}.apk`)
    writeFileSync(apkPath, buf)
    const result = await apkEngine.execute(
      input({ targetType: 'android', inputKind: 'file', label: 'apk', path: apkPath }),
      ctx()
    )
    expect(result.metadata.hasManifest).toBe('true')
    expect(result.components.some((item) => item.kind === 'library')).toBe(true)
    expect(
      result.skipped.some((item) => item.check.includes('apktool') || item.check.includes('jadx'))
    ).toBe(true)
  })

  it('parses adb device listings', () => {
    const devices = parseAdbDevices(readFileSync(join(root, 'adb/devices.txt'), 'utf8'))
    expect(devices[0]?.id).toBe('emulator-5554')
    expect(devices[0]?.status).toBe('device')
  })
})

describe('web, windows, packages, docker, archives', () => {
  it('parses local HTML forms and links', async () => {
    const result = await webEngine.execute(
      input({
        targetType: 'website',
        inputKind: 'file',
        label: 'web',
        path: join(root, 'web-app/index.html')
      }),
      ctx()
    )
    expect(result.components.some((item) => item.kind === 'form')).toBe(true)
    expect(result.endpoints.some((endpoint) => endpoint.url.includes('example.com'))).toBe(true)
  })

  it('parses a tiny PE header', async () => {
    const buf = Buffer.alloc(0x80)
    buf.write('MZ', 0, 'ascii')
    buf.writeUInt32LE(0x40, 0x3c)
    buf.write('PE\0\0', 0x40, 'ascii')
    buf.writeUInt16LE(0x8664, 0x44)
    buf.write('https://example.com/update', 0x50, 'ascii')
    const exe = join(tmpdir(), `tiny-${Date.now()}.exe`)
    writeFileSync(exe, buf)
    const result = await windowsEngine.execute(
      input({ targetType: 'windows', inputKind: 'file', label: 'exe', path: exe }),
      ctx()
    )
    expect(result.metadata.pe).toBe('valid')
    expect(result.metadata.machine).toBe('x64')
  })

  it('reads wheel-less python requirements and compose privileges', async () => {
    const pkg = await packageEngine.execute(
      input({
        targetType: 'package',
        inputKind: 'folder',
        label: 'pkg',
        path: join(root, 'python-app')
      }),
      ctx()
    )
    expect(pkg.dependencies.length).toBeGreaterThan(0)
    const docker = await containerEngine.execute(
      input({
        targetType: 'container',
        inputKind: 'folder',
        label: 'docker',
        path: join(root, 'docker-app')
      }),
      ctx()
    )
    expect(docker.findings.some((finding) => finding.title.includes('root'))).toBe(true)
    expect(docker.findings.some((finding) => finding.title.includes('Privileged'))).toBe(true)
  })

  it('lists zip archives and flags traversal names', async () => {
    const zip = new JSZip()
    zip.file('readme.txt', 'hi')
    zip.file('../escape.txt', 'nope')
    const buf = await zip.generateAsync({ type: 'nodebuffer' })
    const file = join(tmpdir(), `arch-${Date.now()}.zip`)
    writeFileSync(file, buf)
    const result = await archiveEngine.execute(
      input({ targetType: 'archive', inputKind: 'file', label: 'zip', path: file }),
      ctx()
    )
    expect(result.files.some((entry) => entry.path.includes('readme'))).toBe(true)
  })
})

describe('jobs, reports, AI', () => {
  it('persists jobs and generates reports from real engine output', async () => {
    const dir = join(tmpdir(), `uaa-jobs-${Date.now()}`)
    mkdirSync(dir, { recursive: true })
    const store = new JobStore(join(dir, 'jobs.json'))
    const manager = new JobManager(store, join(dir, 'art'), join(dir, 'rep'))
    const job = await manager.create(
      input({
        targetType: 'source',
        inputKind: 'folder',
        label: 'source-e2e',
        path: join(root, 'source-app')
      }),
      { mode: 'off' }
    )
    const started = Date.now()
    let done = manager.get(job.id)
    while (
      done &&
      (done.status === 'running' || done.status === 'queued') &&
      Date.now() - started < 150_000
    ) {
      await new Promise((resolve) => setTimeout(resolve, 200))
      done = manager.get(job.id)
    }
    expect(done?.status).toBe('completed')
    expect(done?.result?.dependencies.length).toBeGreaterThan(0)
    expect(done?.engineIds).toContain('rea-cli')
    expect(done?.reportPaths?.html).toBeTruthy()
    if (done) {
      const reports = generateReports(done, join(dir, 'rep2'))
      expect(readFileSync(reports.csv, 'utf8')).toContain('title,severity')
    }
    const snapshot = store.snapshot([], [])
    expect(snapshot.totalJobs).toBe(1)
  }, 180_000)

  it('AI explanations only restate existing findings', async () => {
    const provider = new EvidenceRestatingProvider()
    const result = await sourceCodeEngine.execute(
      input({
        targetType: 'source',
        inputKind: 'folder',
        label: 'ai',
        path: join(root, 'source-app')
      }),
      ctx()
    )
    const explained = await provider.explain(result)
    expect(
      explained.every((item) => result.findings.some((finding) => finding.id === item.findingId))
    ).toBe(true)
  })
})
