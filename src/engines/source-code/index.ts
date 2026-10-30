import { existsSync, readFileSync, statSync } from 'node:fs'
import { basename, join } from 'node:path'
import * as acorn from 'acorn'
import {
  emptyAnalysisResult,
  type AnalysisResult,
  type ComponentRecord,
  type EndpointRecord
} from '../../shared/types/analysis'
import type { AnalysisEngineRuntime, AnalysisInput, EngineContext } from '../../shared/types/engine'
import { makeId } from '../base/ids'
import { extractUrls, findSecretFindings } from '../base/extract'
import { extOf, readTextFile, walkFiles } from '../base/walk'
import { extractZipLimited } from '../base/zip'

const JS_EXTS = new Set(['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx'])
const PY_EXTS = new Set(['.py'])
const HTML_EXTS = new Set(['.html', '.htm'])

function detectProjectKind(_root: string, files: string[]): string {
  if (files.includes('package.json')) {
    return 'node'
  }
  if (files.includes('pyproject.toml') || files.includes('requirements.txt')) {
    return 'python'
  }
  if (files.some((f) => f.endsWith('build.gradle') || f.endsWith('pom.xml'))) {
    return 'jvm'
  }
  if (
    files.includes('AndroidManifest.xml') ||
    files.some((f) => f.endsWith('/AndroidManifest.xml'))
  ) {
    return 'android-source'
  }
  return 'generic'
}

function parsePackageJson(root: string, result: AnalysisResult): void {
  const abs = join(root, 'package.json')
  if (!existsSync(abs)) {
    return
  }
  try {
    const pkg = JSON.parse(readFileSync(abs, 'utf8')) as {
      name?: string
      version?: string
      dependencies?: Record<string, string>
      devDependencies?: Record<string, string>
      scripts?: Record<string, string>
      main?: string
    }
    result.metadata['package.name'] = pkg.name ?? basename(root)
    result.metadata['package.version'] = pkg.version ?? 'unknown'
    result.metadata['package.main'] = pkg.main ?? ''
    for (const [name, version] of Object.entries(pkg.dependencies ?? {})) {
      result.dependencies.push({ name, version, source: 'package.json dependencies' })
    }
    for (const [name, version] of Object.entries(pkg.devDependencies ?? {})) {
      result.dependencies.push({ name, version, source: 'package.json devDependencies' })
    }
    result.graph.nodes.push({ id: 'pkg:root', label: pkg.name ?? basename(root), kind: 'project' })
    for (const dep of result.dependencies) {
      const id = `dep:${dep.name}`
      result.graph.nodes.push({ id, label: dep.name, kind: 'dependency' })
      result.graph.edges.push({ from: 'pkg:root', to: id, kind: 'depends' })
    }
    if (pkg.scripts && Object.keys(pkg.scripts).length > 0) {
      result.metadata['package.scripts'] = Object.keys(pkg.scripts).join(', ')
    }
  } catch {
    result.limitations.push('package.json was present but could not be parsed as JSON.')
  }
}

function parsePythonDeps(root: string, result: AnalysisResult): void {
  const req = join(root, 'requirements.txt')
  if (existsSync(req)) {
    const text = readFileSync(req, 'utf8')
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) {
        continue
      }
      const name = trimmed.split(/[=<>~[]/)[0]?.trim()
      if (name) {
        result.dependencies.push({
          name,
          version: trimmed.slice(name.length),
          source: 'requirements.txt'
        })
      }
    }
  }
  const pyproject = join(root, 'pyproject.toml')
  if (existsSync(pyproject)) {
    const text = readFileSync(pyproject, 'utf8')
    const name = text.match(/name\s*=\s*"([^"]+)"/)
    const version = text.match(/version\s*=\s*"([^"]+)"/)
    if (name) {
      result.metadata['python.name'] = name[1]
    }
    if (version) {
      result.metadata['python.version'] = version[1]
    }
  }
}

function jsImports(code: string): string[] {
  const names = new Set<string>()
  const fromRe = /(?:import|export)\s+(?:[\s\S]*?\sfrom\s+)?['"]([^'"]+)['"]/g
  const reqRe = /require\(\s*['"]([^'"]+)['"]\s*\)/g
  let match: RegExpExecArray | null
  while ((match = fromRe.exec(code))) {
    names.add(match[1])
  }
  while ((match = reqRe.exec(code))) {
    names.add(match[1])
  }
  try {
    const ast = acorn.parse(code, {
      ecmaVersion: 'latest',
      sourceType: 'module',
      allowHashBang: true
    }) as acorn.Node & { body?: Array<{ type: string; source?: { value?: string } }> }
    for (const node of ast.body ?? []) {
      if (node.type === 'ImportDeclaration' && node.source?.value) {
        names.add(String(node.source.value))
      }
    }
  } catch {
    // Regex fallback already applied. Syntax errors are expected in TS/JSX.
  }
  return [...names]
}

function pyImports(code: string): string[] {
  const names = new Set<string>()
  for (const line of code.split(/\r?\n/)) {
    const direct = line.match(/^\s*import\s+([A-Za-z0-9_.]+)/)
    const from = line.match(/^\s*from\s+([A-Za-z0-9_.]+)\s+import\s+/)
    if (direct) {
      names.add(direct[1])
    }
    if (from) {
      names.add(from[1])
    }
  }
  return [...names]
}

function findRoutes(path: string, code: string): EndpointRecord[] {
  const endpoints: EndpointRecord[] = []
  const express =
    /(?:app|router)\.(get|post|put|delete|patch|options|head)\(\s*['"`]([^'"`]+)['"`]/gi
  const fastapi = /@(?:app|router)\.(get|post|put|delete|patch)\(\s*['"`]([^'"`]+)['"`]/gi
  const flask = /@app\.route\(\s*['"`]([^'"`]+)['"`]/gi
  let match: RegExpExecArray | null
  while ((match = express.exec(code))) {
    endpoints.push({
      id: makeId('ep'),
      method: match[1].toUpperCase(),
      url: match[2],
      source: 'source',
      evidence: [
        { id: makeId('ev'), kind: 'line', path, snippet: match[0], note: 'Express-style route' }
      ]
    })
  }
  while ((match = fastapi.exec(code))) {
    endpoints.push({
      id: makeId('ep'),
      method: match[1].toUpperCase(),
      url: match[2],
      source: 'source',
      evidence: [
        { id: makeId('ev'), kind: 'line', path, snippet: match[0], note: 'FastAPI-style route' }
      ]
    })
  }
  while ((match = flask.exec(code))) {
    endpoints.push({
      id: makeId('ep'),
      method: 'ANY',
      url: match[1],
      source: 'source',
      evidence: [
        { id: makeId('ev'), kind: 'line', path, snippet: match[0], note: 'Flask-style route' }
      ]
    })
  }
  return endpoints
}

function analyzeFolder(root: string, input: AnalysisInput, ctx: EngineContext): AnalysisResult {
  const result = emptyAnalysisResult()
  const walked = walkFiles(root)
  const rels = walked.map((f) => f.relPath)
  result.metadata.projectKind = detectProjectKind(root, rels)
  result.metadata.fileCount = String(walked.length)
  result.metadata.root = root
  parsePackageJson(root, result)
  parsePythonDeps(root, result)

  const localModules: ComponentRecord[] = []
  const importGraph = new Map<string, string[]>()

  for (const file of walked) {
    if (ctx.isCancelled()) {
      result.limitations.push('Walk stopped because the job was cancelled.')
      break
    }
    result.files.push({
      path: file.relPath,
      size: file.size,
      kind: extOf(file.relPath).slice(1) || 'file'
    })
    const ext = extOf(file.relPath)
    const text =
      JS_EXTS.has(ext) ||
      PY_EXTS.has(ext) ||
      HTML_EXTS.has(ext) ||
      ext === '.json' ||
      ext === '.env'
        ? readTextFile(file.absPath)
        : null
    if (!text) {
      continue
    }
    if (input.profile.security) {
      result.findings.push(...findSecretFindings('source-static', file.relPath, text))
      if (/\beval\s*\(/.test(text) || /\bexec\s*\(/.test(text)) {
        result.findings.push({
          id: makeId('find'),
          title: 'Dynamic code execution',
          severity: 'medium',
          category: 'unsafe-execution',
          evidence: [
            {
              id: makeId('ev'),
              kind: 'line',
              path: file.relPath,
              snippet: 'eval/exec',
              note: 'eval or exec call'
            }
          ],
          affected: file.relPath,
          explanation:
            'The file contains eval/exec, which can run attacker-controlled code if input is not trusted.',
          confidence: 'medium',
          remediation: 'Avoid eval/exec. Use explicit parsers or allow-lists.',
          engineId: 'source-static',
          falsePositiveNotes: 'Build tools and tests sometimes use eval on trusted input.'
        })
      }
    }
    if (input.profile.api) {
      for (const url of extractUrls(text)) {
        result.endpoints.push({
          id: makeId('ep'),
          url,
          source: 'source',
          evidence: [
            {
              id: makeId('ev'),
              kind: 'line',
              path: file.relPath,
              snippet: url,
              note: 'Literal URL'
            }
          ]
        })
      }
      result.endpoints.push(...findRoutes(file.relPath, text))
    }
    if (JS_EXTS.has(ext)) {
      const component: ComponentRecord = {
        id: makeId('cmp'),
        kind: 'module',
        name: file.relPath,
        path: file.relPath
      }
      localModules.push(component)
      result.components.push(component)
      const imports = jsImports(text)
      importGraph.set(file.relPath, imports)
      for (const spec of imports) {
        result.graph.edges.push({ from: file.relPath, to: spec, kind: 'import' })
      }
      const fnRe = /(?:export\s+)?(?:async\s+)?function\s+([A-Za-z0-9_]+)/g
      let fn: RegExpExecArray | null
      while ((fn = fnRe.exec(text))) {
        result.components.push({
          id: makeId('cmp'),
          kind: 'function',
          name: fn[1],
          path: file.relPath
        })
      }
    }
    if (PY_EXTS.has(ext)) {
      result.components.push({
        id: makeId('cmp'),
        kind: 'module',
        name: file.relPath,
        path: file.relPath
      })
      for (const spec of pyImports(text)) {
        result.graph.edges.push({ from: file.relPath, to: spec, kind: 'import' })
      }
    }
    if (HTML_EXTS.has(ext)) {
      result.components.push({
        id: makeId('cmp'),
        kind: 'page',
        name: file.relPath,
        path: file.relPath
      })
    }
    if (/\bprocess\.env\.[A-Z0-9_]+/.test(text) || /\bos\.environ/.test(text)) {
      result.components.push({
        id: makeId('cmp'),
        kind: 'config',
        name: 'environment variable references',
        path: file.relPath
      })
    }
  }

  for (const node of new Set([...importGraph.keys(), ...[...importGraph.values()].flat()])) {
    if (!result.graph.nodes.some((n) => n.id === node)) {
      result.graph.nodes.push({
        id: node,
        label: node,
        kind:
          node.startsWith('.') || node.endsWith('.js') || node.endsWith('.ts')
            ? 'module'
            : 'package'
      })
    }
  }

  result.limitations.push(
    'Decompiled or generated code is not treated as original source. Import parsing uses AST where JS parses, otherwise regex.'
  )
  return result
}

export const sourceCodeEngine: AnalysisEngineRuntime = {
  descriptor: {
    id: 'source-static',
    displayName: 'Source-code static analysis',
    version: '1.0.0',
    supportedPlatforms: ['win32', 'darwin', 'linux'],
    supportedTargetTypes: ['source', 'tool'],
    supportedInputKinds: ['file', 'folder'],
    requiredUtilities: [],
    requiredPermissions: ['filesystem'],
    needsNetwork: false,
    involvesRuntime: false,
    capabilities: [
      'project detection',
      'dependency inventory',
      'import graph',
      'route extraction',
      'secret pattern scan'
    ]
  },
  validate(input) {
    const errors: string[] = []
    if (!input.path) {
      errors.push('A folder or archive path is required.')
    } else if (!existsSync(input.path)) {
      errors.push(`Path does not exist: ${input.path}`)
    }
    return { ok: errors.length === 0, errors, warnings: [] }
  },
  async execute(input, ctx) {
    ctx.emitLog('Starting source-code static analysis.')
    if (!input.path) {
      throw new Error('Missing path.')
    }
    let root = input.path
    const stat = statSync(root)
    if (stat.isFile() && root.toLowerCase().endsWith('.zip')) {
      const dest = join(ctx.artifactDir, 'extracted-source')
      ctx.emitLog('Extracting ZIP source archive with size and path limits.')
      await extractZipLimited(readFileSync(root), dest)
      root = dest
    } else if (!stat.isDirectory()) {
      throw new Error('Source analysis expects a project folder or a ZIP archive.')
    }
    const result = analyzeFolder(root, input, ctx)
    ctx.emitLog(`Indexed ${result.files.length} files.`)
    return result
  }
}
