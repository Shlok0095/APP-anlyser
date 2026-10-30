import { existsSync } from 'node:fs'
import { extname, join } from 'node:path'
import {
  emptyAnalysisResult,
  mergeAnalysisResults,
  type AnalysisResult
} from '../../shared/types/analysis'
import type { AnalysisEngineRuntime, EngineContext } from '../../shared/types/engine'
import { missingAnalysisTarget } from '../../shared/validation/input'
import { REA_PACKAGE, resolveReaLauncher, runReaCommand } from './cli'
import { isManagedPe, planManagedMembersFollowup, planReaFollowups } from './followup'
import { mapReaDocument } from './map'
import { PE_EXT, planReaInvocations, type ReaInvocation } from './plan'
import { projectReaWorkspace } from './workspace'

function withNativeSnapshot(invocation: ReaInvocation, path: string | undefined, snapshotPath: string): ReaInvocation {
  if (!path || !PE_EXT.test(extname(path))) {
    return invocation
  }
  if (invocation.command !== 'analyze' && invocation.command !== 'search') {
    return invocation
  }
  return {
    ...invocation,
    flags: [...(invocation.flags ?? []), '--snapshot', snapshotPath]
  }
}

async function runInvocation(
  ctx: EngineContext,
  invocation: ReaInvocation,
  into: AnalysisResult[]
): Promise<unknown | null> {
  const ran = await runReaCommand(ctx, invocation.command, invocation.positional, {
    timeoutMs: invocation.timeoutMs,
    filterOutput: invocation.filterOutput,
    flags: invocation.flags,
    outputName: invocation.outputName
  })
  if (ran.result.timedOut) {
    into[0]?.skipped.push({
      check: `rea:${invocation.outputName ?? invocation.command}`,
      reason: `REA ${invocation.command} timed out after ${invocation.timeoutMs}ms.`
    })
    return null
  }
  if (!ran.document) {
    const detail = ran.result.stderr.trim().slice(0, 400) || `exit ${ran.result.code}`
    into[0]?.skipped.push({
      check: `rea:${invocation.outputName ?? invocation.command}`,
      reason: `REA ${invocation.command} produced no JSON (${detail}).`
    })
    return null
  }
  const mapped = mapReaDocument(ran.document, invocation.outputName ?? invocation.command, 'rea-cli')
  mapped.metadata.reaJsonPath = ran.jsonPath
  into.push(mapped)
  ctx.emitLog(mapped.logs.at(-1) ?? `REA ${invocation.command} finished.`)
  return ran.document
}

export const reaEngine: AnalysisEngineRuntime = {
  descriptor: {
    id: 'rea-cli',
    displayName: 'REA (morluto/rea)',
    version: '6.8.0',
    supportedPlatforms: ['win32', 'darwin', 'linux'],
    supportedTargetTypes: [
      'android',
      'windows',
      'macos',
      'linux',
      'website',
      'source',
      'package',
      'container',
      'archive',
      'tool'
    ],
    supportedInputKinds: ['file', 'folder', 'url', 'package-name', 'device-package'],
    requiredUtilities: ['node or rea'],
    requiredPermissions: ['filesystem'],
    needsNetwork: false,
    involvesRuntime: false,
    capabilities: [
      'rea analyze overview',
      'native procedure and string inventory',
      'PE resources, imports, certificates, Go/Rust, Electron fuses',
      'JavaScript summary, facts, modules, and routes via evidence-file',
      'typed ELF/Mach-O/WASM/SQLite/Flutter/IL2CPP follow-ups',
      'full Evidence workspace on disk',
      'Android APK inspection and class inventory via JADX when present',
      'ADB package dumpsys'
    ]
  },
  validate(input) {
    const errors: string[] = []
    const warnings: string[] = []
    const missing = missingAnalysisTarget(input)
    if (missing) {
      errors.push(missing)
    }
    if (!resolveReaLauncher()) {
      errors.push(
        `REA CLI was not found. Install Node.js and use \`npx -y ${REA_PACKAGE}\`, or put \`rea\` on PATH.`
      )
    }
    if (
      input.path &&
      !existsSync(input.path) &&
      (input.inputKind === 'file' || input.inputKind === 'folder')
    ) {
      errors.push(`Target does not exist: ${input.path}`)
    }
    if (input.inputKind === 'url') {
      warnings.push('Bare URLs are not sent to REA without a CDP browser target.')
    }
    return { ok: errors.length === 0, errors, warnings }
  },
  async execute(input, ctx) {
    const result = emptyAnalysisResult()
    const launcher = resolveReaLauncher()
    if (!launcher) {
      result.skipped.push({
        check: 'rea-cli',
        reason:
          `REA CLI was not found. Install Node.js and ${REA_PACKAGE}, or set UAA_REA_BIN to a rea executable.`
      })
      return result
    }
    result.metadata.reaLauncher = launcher.display
    result.metadata.reaWorkspaceDir = ctx.artifactDir
    const plan = planReaInvocations(input)
    result.skipped.push(...plan.skipped)
    if (plan.invocations.length === 0) {
      ctx.emitLog('REA had no applicable command for this target.')
      return result
    }

    const parts: AnalysisResult[] = [result]
    let analyzeDocument: unknown = null
    const snapshotPath = join(ctx.artifactDir, 'rea-native-snapshot.json')
    const followupsPreview = input.path ? planReaFollowups(input.path, null) : []
    const totalSteps = Math.max(1, plan.invocations.length + followupsPreview.length + 1)
    for (const [index, invocation] of plan.invocations.entries()) {
      if (ctx.isCancelled()) {
        throw new Error('Cancelled')
      }
      ctx.emitProgress(invocation.label, Math.round(((index + 1) / totalSteps) * 70))
      const document = await runInvocation(
        ctx,
        withNativeSnapshot(invocation, input.path, snapshotPath),
        parts
      )
      if (invocation.command === 'analyze' && document) {
        analyzeDocument = document
        const evidencePath = parts.at(-1)?.metadata.reaJsonPath
        if (evidencePath && typeof (document as { evidence_id?: unknown }).evidence_id === 'string') {
          ctx.emitProgress('Projecting REA summary and module views', 72)
          parts.push(await projectReaWorkspace(ctx, document, evidencePath))
        }
      }
    }

    if (input.path) {
      const followups = planReaFollowups(input.path, analyzeDocument)
      for (const [index, invocation] of followups.entries()) {
        if (ctx.isCancelled()) {
          throw new Error('Cancelled')
        }
        ctx.emitProgress(
          invocation.label,
          Math.round(((plan.invocations.length + index + 1) / (plan.invocations.length + followups.length + 1)) * 95)
        )
        const document = await runInvocation(
          ctx,
          withNativeSnapshot(invocation, input.path, snapshotPath),
          parts
        )
        if (
          invocation.command === 'inspect-managed-artifact' &&
          document &&
          isManagedPe(document)
        ) {
          ctx.emitProgress('Managed PE/CLI members', 96)
          await runInvocation(ctx, planManagedMembersFollowup(input.path), parts)
        }
      }
    }
    return mergeAnalysisResults(parts)
  }
}
