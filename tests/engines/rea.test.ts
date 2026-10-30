import { mkdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PROFILE,
  type AnalysisInput,
  type EngineContext
} from '../../src/shared/types/engine'
import { missingAnalysisTarget } from '../../src/shared/validation/input'
import { extractReaJson, resolveReaLauncher } from '../../src/engines/rea/cli'
import { isManagedPe, planReaFollowups } from '../../src/engines/rea/followup'
import { mapReaDocument } from '../../src/engines/rea/map'
import { planReaInvocations } from '../../src/engines/rea/plan'
import { buildAnalysisViewRequest } from '../../src/engines/rea/workspace'
import { reaEngine } from '../../src/engines/rea'
import { enginesFor } from '../../src/engines/registry'
import { JobManager } from '../../src/main/jobs/manager'
import { JobStore } from '../../src/main/storage/job-store'

const fixtures = join(__dirname, '../../fixtures')
const sample = JSON.parse(readFileSync(join(__dirname, 'rea-js-evidence.json'), 'utf8')) as unknown

function ctx(stdout: string): EngineContext {
  const artifactDir = join(tmpdir(), `uaa-rea-${Date.now()}-${Math.random().toString(16).slice(2)}`)
  mkdirSync(artifactDir, { recursive: true })
  return {
    artifactDir,
    isCancelled: () => false,
    emitLog: () => undefined,
    emitProgress: () => undefined,
    runCommand: async () => ({
      code: 0,
      stdout,
      stderr: '',
      timedOut: false
    }),
    fetchText: async () => ''
  }
}

function input(
  partial: Partial<AnalysisInput> & Pick<AnalysisInput, 'targetType' | 'inputKind' | 'label'>
): AnalysisInput {
  return { profile: { ...DEFAULT_PROFILE }, ...partial }
}

describe('REA planning', () => {
  it('strips REA progress lines from CLI JSON', () => {
    const parsed = extractReaJson(
      '{"rea_progress":{"phase":"x"}}\n{"normalized_result":{"format":"directory"}}\n'
    )
    expect(parsed).toMatchObject({ normalized_result: { format: 'directory' } })
  })

  it('routes local folders and files through rea analyze', () => {
    const plan = planReaInvocations(
      input({
        targetType: 'source',
        inputKind: 'folder',
        label: 'source',
        path: join(fixtures, 'source-app')
      })
    )
    expect(plan.invocations[0]?.command).toBe('analyze')
    expect(plan.skipped).toEqual([])
  })

  it('still sends Python and Docker folders to rea analyze', () => {
    const python = planReaInvocations(
      input({
        targetType: 'package',
        inputKind: 'folder',
        label: 'py',
        path: join(fixtures, 'python-app')
      })
    )
    expect(python.invocations[0]?.command).toBe('analyze')

    const docker = planReaInvocations(
      input({
        targetType: 'container',
        inputKind: 'folder',
        label: 'docker',
        path: join(fixtures, 'docker-app')
      })
    )
    expect(docker.invocations[0]?.command).toBe('analyze')
  })

  it('refuses bare URLs that are not CDP targets', () => {
    const plan = planReaInvocations(
      input({
        targetType: 'website',
        inputKind: 'url',
        label: 'web',
        url: 'http://127.0.0.1:4173'
      })
    )
    expect(plan.invocations).toEqual([])
    expect(plan.skipped[0]?.check).toBe('rea-web-url')
  })

  it('selects REA first for source folders', () => {
    const selected = enginesFor(
      input({
        targetType: 'source',
        inputKind: 'folder',
        label: 'source',
        path: join(fixtures, 'source-app')
      })
    )
    expect(selected[0]?.descriptor.id).toBe('rea-cli')
    expect(selected.some((engine) => engine.descriptor.id === 'source-static')).toBe(true)
  })
})

describe('REA evidence mapping', () => {
  it('maps JavaScript application graphs into UAA records', () => {
    const mapped = mapReaDocument(sample, 'analyze-javascript-application', 'rea-cli')
    expect(mapped.metadata['package.name']).toBe('uaa-sample-source')
    expect(mapped.endpoints.some((endpoint) => endpoint.url === '/health')).toBe(true)
    expect(mapped.components.some((item) => item.kind === 'module')).toBe(true)
    expect(mapped.graph.edges.length).toBeGreaterThan(0)
    expect(mapped.limitations.length).toBeGreaterThan(0)
    expect(mapped.skipped).toEqual([])
  })

  it('plans native follow-ups after a PE binary_overview', () => {
    const followups = planReaFollowups('C:\\app.exe', {
      operation: 'binary_overview',
      subject: { format: 'pe', name: 'app.exe' }
    })
    expect(followups.map((item) => item.outputName ?? item.command)).toEqual(
      expect.arrayContaining([
        'inspect-pe-resources',
        'inspect-pe-imports',
        'inspect-pe-certificates',
        'inspect-managed-artifact',
        'inspect-electron-fuses',
        'inspect-go-binary',
        'inspect-rust-binary',
        'search-procedures',
        'search-strings'
      ])
    )
    expect(planReaFollowups(join(fixtures, 'source-app'), sample)).toEqual([])
  })

  it('plans APK inventory plus Android class and Flutter follow-ups', () => {
    const plan = planReaInvocations(
      input({
        targetType: 'android',
        inputKind: 'file',
        label: 'apk',
        path: 'C:\\app.apk'
      })
    )
    expect(plan.invocations.map((item) => item.command)).toEqual([
      'analyze',
      'inspect-android-package',
      'inspect-artifact'
    ])
    expect(planReaFollowups('C:\\app.apk', null).map((item) => item.command)).toEqual(
      expect.arrayContaining(['identify-flutter-build', 'search-android-classes'])
    )
  })

  it('plans ELF, Mach-O, WASM, SQLite, and IL2CPP tools by file type', () => {
    expect(planReaFollowups('C:\\libfoo.so', null).map((item) => item.command)).toEqual(
      expect.arrayContaining(['inspect-elf-notes', 'inspect-binary-layout'])
    )
    expect(planReaFollowups('C:\\libbar.dylib', null).map((item) => item.command)).toEqual(
      expect.arrayContaining(['inspect-macho', 'inspect-plist'])
    )
    expect(planReaFollowups('C:\\mod.wasm', null).map((item) => item.command)).toEqual(
      expect.arrayContaining(['inspect-wasm-artifact'])
    )
    expect(planReaFollowups('C:\\data.sqlite', null).map((item) => item.command)).toEqual(
      expect.arrayContaining(['inspect-sqlite-database'])
    )
    expect(
      planReaFollowups('C:\\il2cpp\\global-metadata.dat', null).map((item) => item.command)
    ).toEqual(expect.arrayContaining(['inspect-il2cpp-metadata']))
  })

  it('projects JS views from an evidence-file, not an inline blob', () => {
    const request = buildAnalysisViewRequest('C:\\jobs\\rea-analyze.json', { kind: 'summary' })
    expect(request.source).toEqual({
      kind: 'evidence-file',
      path: 'C:\\jobs\\rea-analyze.json'
    })
  })

  it('maps a Ghidra binary_overview into segments and metadata', () => {
    const mapped = mapReaDocument(
      {
        operation: 'binary_overview',
        subject: {
          name: 'app.exe',
          format: 'pe',
          architecture: 'x86',
          digest: { sha256: 'abc123' }
        },
        normalized_result: {
          image_base: '0x400000',
          procedure_count: 12,
          string_count: 40,
          segment_count: 2,
          segments: [
            { name: '.text', start: '0x401000', end: '0x402000', length: 4096 },
            { name: '.rdata', start: '0x402000', end: '0x403000', length: 4096 }
          ]
        }
      },
      'analyze',
      'rea-cli'
    )
    expect(mapped.metadata['package.name']).toBe('app.exe')
    expect(mapped.metadata.procedureCount).toBe('12')
    expect(mapped.components.some((item) => item.name === '.text')).toBe(true)
    expect(mapped.files).toHaveLength(2)
  })

  it('maps procedure search hits into function components', () => {
    const mapped = mapReaDocument(
      {
        operation: 'search_procedures',
        normalized_result: [
          { address: '0x401000', value: 'WinMain' },
          { address: '0x401120', value: 'FUN_00401120' }
        ]
      },
      'search-procedures',
      'rea-cli'
    )
    expect(mapped.components.map((item) => item.name)).toEqual(['WinMain', 'FUN_00401120'])
    expect(mapped.components.every((item) => item.kind === 'function')).toBe(true)
  })

  it('maps PE resource identities without decoding payloads', () => {
    const mapped = mapReaDocument(
      {
        operation: 'inspect_pe_resources',
        normalized_result: {
          format: 'pe32',
          resources: [
            {
              index: 0,
              type: { kind: 'name', name: 'ICON' },
              name: { kind: 'id', id: 1 },
              language: { kind: 'id', id: 1033 }
            }
          ]
        }
      },
      'inspect-pe-resources',
      'rea-cli'
    )
    expect(mapped.components[0]?.name).toBe('ICON/1')
    expect(mapped.metadata.peResourceCount).toBe('1')
  })

  it('maps PE import DLLs and functions', () => {
    const mapped = mapReaDocument(
      {
        operation: 'inspect_pe_imports',
        normalized_result: {
          format: 'pe32',
          imports: [
            {
              name: 'KERNEL32.dll',
              functions: [{ name: 'GetProcAddress', ordinal: null }]
            }
          ],
          delay_imports: []
        }
      },
      'inspect-pe-imports',
      'rea-cli'
    )
    expect(mapped.dependencies.some((item) => item.name === 'KERNEL32.dll')).toBe(true)
    expect(mapped.components.some((item) => item.name === 'KERNEL32.dll!GetProcAddress')).toBe(
      true
    )
    expect(mapped.metadata.peImportDllCount).toBe('1')
  })

  it('maps Authenticode certificate subjects without dumping payloads', () => {
    const mapped = mapReaDocument(
      {
        operation: 'inspect_pe_certificates',
        normalized_result: {
          format: 'pe32',
          entries: [
            {
              index: 0,
              certificate_type: 2,
              certificate_type_name: 'pkcs7',
              pkcs7: {
                certificates: [
                  {
                    subject: { text: 'CN=Example' },
                    issuer: { text: 'CN=Issuer' },
                    not_after: '2027-01-01T00:00:00.000Z'
                  }
                ]
              }
            }
          ]
        }
      },
      'inspect-pe-certificates',
      'rea-cli'
    )
    expect(mapped.components[0]?.name).toBe('CN=Example')
    expect(mapped.metadata.peCertificateCount).toBe('1')
  })

  it('maps Android class search matches', () => {
    const mapped = mapReaDocument(
      {
        operation: 'search_android_classes',
        normalized_result: {
          query: '',
          total_classes: 2,
          matches: ['com.example.MainActivity', 'com.example.Helper']
        }
      },
      'search-android-classes',
      'rea-cli'
    )
    expect(mapped.components.map((item) => item.name)).toEqual([
      'com.example.MainActivity',
      'com.example.Helper'
    ])
    expect(mapped.metadata.androidClassCount).toBe('2')
  })

  it('maps managed types and skips members on not-managed PE', () => {
    expect(
      isManagedPe({
        normalized_result: { classification: { status: 'not-managed' } }
      })
    ).toBe(false)
    expect(
      isManagedPe({
        normalized_result: { classification: { status: 'cli' } }
      })
    ).toBe(true)
    const mapped = mapReaDocument(
      {
        operation: 'inspect_managed_members',
        normalized_result: {
          types: [{ full_name: 'Acme.App', namespace: 'Acme' }],
          methods: [{ name: 'Main', declaring_type: 'Acme.App' }]
        }
      },
      'inspect-managed-members',
      'rea-cli'
    )
    expect(mapped.components.some((item) => item.kind === 'class' && item.name === 'Acme.App')).toBe(
      true
    )
    expect(mapped.components.some((item) => item.kind === 'function' && item.name === 'Main')).toBe(
      true
    )
  })

  it('records REA error envelopes as skipped checks', () => {
    const mapped = mapReaDocument(
      {
        error: 'Analysis failed',
        code: 'target_unavailable',
        message: 'open_binary accepts files and macOS app bundles.'
      },
      'inspect-artifact',
      'rea-cli'
    )
    expect(mapped.skipped[0]?.reason).toContain('target_unavailable')
    expect(mapped.components).toEqual([])
  })
})

describe('REA engine adapter', () => {
  it('maps mocked CLI JSON without fabricating findings', async () => {
    const result = await reaEngine.execute(
      input({
        targetType: 'source',
        inputKind: 'folder',
        label: 'source',
        path: join(fixtures, 'source-app')
      }),
      ctx(JSON.stringify(sample))
    )
    expect(result.metadata.reaCommand).toBe('analyze')
    expect(result.endpoints.some((endpoint) => endpoint.url === '/health')).toBe(true)
  })

  it('blocks empty Analyze targets', () => {
    expect(
      missingAnalysisTarget({
        inputKind: 'file',
        path: '',
        url: undefined,
        packageName: undefined,
        deviceId: undefined
      })
    ).toMatch(/file or folder/)
  })

  it('fails jobs that have no target path', async () => {
    const dir = join(tmpdir(), `uaa-rea-empty-${Date.now()}`)
    mkdirSync(dir, { recursive: true })
    const manager = new JobManager(
      new JobStore(join(dir, 'jobs.json')),
      join(dir, 'art'),
      join(dir, 'rep')
    )
    const job = await manager.create(
      input({ targetType: 'android', inputKind: 'file', label: 'android' }),
      { mode: 'off' }
    )
    expect(job.status).toBe('failed')
    expect(job.errors[0]).toMatch(/file or folder/)
  })
})

describe('live REA CLI', () => {
  it('analyzes the source fixture through rea-agents', async () => {
    const launcher = resolveReaLauncher()
    expect(launcher).not.toBeNull()
    const artifactDir = join(tmpdir(), `uaa-rea-live-${Date.now()}`)
    mkdirSync(artifactDir, { recursive: true })
    const { runCommand } = await import('../../src/engines/base/spawn')
    const result = await reaEngine.execute(
      input({
        targetType: 'source',
        inputKind: 'folder',
        label: 'source-live',
        path: join(fixtures, 'source-app')
      }),
      {
        artifactDir,
        isCancelled: () => false,
        emitLog: () => undefined,
        emitProgress: () => undefined,
        runCommand,
        fetchText: async () => ''
      }
    )
    expect(result.skipped.filter((item) => item.check.startsWith('rea:'))).toEqual([])
    expect(result.skipped.filter((item) => item.check.startsWith('rea-view:'))).toEqual([])
    expect(result.metadata.reaCommand).toBe('analyze')
    expect(result.metadata.reaEvidencePath).toBeTruthy()
    expect(result.metadata['reaView.summary']).toBeTruthy()
    expect(result.graph.nodes.length + result.components.length).toBeGreaterThan(0)
    expect(result.endpoints.some((endpoint) => endpoint.url === '/health')).toBe(true)
  }, 180_000)
})
