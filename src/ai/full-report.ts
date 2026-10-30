import { NVIDIA_CHAT_URL, NVIDIA_PRIMARY_MODEL } from '../shared/nvidia'
import { nvidiaCompleteMarkdown, type NvidiaClientOptions } from './nvidia'
import { mergeStructuredMarkdown, redactSecrets } from '../main/reports/full-markdown'

const MAX_PROMPT_CHARS = 360_000
const OPENAI_DEFAULT_BASE = 'https://api.openai.com/v1'
const OPENAI_DEFAULT_MODEL = 'gpt-4.1'

const SYSTEM = `You are structuring a reconstruction brief for Universal Application Analyzer.
The user will paste a complete evidence Markdown file from a local static analysis.
Write a reconstruction brief an engineer can give to Cursor or Claude Code to rebuild a similar app.
Rules:
- Never invent files, APIs, classes, strings, imports, certificates, or runtime behavior.
- Keep YAML front matter and the process timeline table, including every process_id and timestamp.
- Use listed evidence only. A complete inventory appendix is attached after your output, so do not paste every row.
- Mark unknowns explicitly.
- Do not include API keys or secrets.
- Output markdown only.`

export interface ReportAiOptions extends Pick<NvidiaClientOptions, 'fetchImpl' | 'sleep'> {
  apiKey?: string
  model?: string
  nvidiaApiKey?: string
  nvidiaModel?: string
  openaiApiKey?: string
  openaiBaseUrl?: string
  openaiModel?: string
  appendix?: string
}

export function chatCompletionsUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, '')
  if (!trimmed) {
    return `${OPENAI_DEFAULT_BASE}/chat/completions`
  }
  return trimmed.endsWith('/chat/completions') ? trimmed : `${trimmed}/chat/completions`
}

interface ReportProvider {
  name: string
  apiKey: string
  model: string
  chatUrl: string
  includeNvidiaTemplate: boolean
}

function reportProviders(options: ReportAiOptions): ReportProvider[] {
  const providers: ReportProvider[] = []
  const nvidiaKey = (options.nvidiaApiKey ?? options.apiKey ?? '').trim()
  if (nvidiaKey) {
    providers.push({
      name: 'NVIDIA',
      apiKey: nvidiaKey,
      model: options.nvidiaModel || options.model || NVIDIA_PRIMARY_MODEL,
      chatUrl: NVIDIA_CHAT_URL,
      includeNvidiaTemplate: true
    })
  }
  const openaiKey = (options.openaiApiKey ?? '').trim()
  if (openaiKey) {
    providers.push({
      name: 'OpenAI-compatible',
      apiKey: openaiKey,
      model: options.openaiModel?.trim() || OPENAI_DEFAULT_MODEL,
      chatUrl: chatCompletionsUrl(options.openaiBaseUrl || OPENAI_DEFAULT_BASE),
      includeNvidiaTemplate: false
    })
  }
  return providers
}

export async function structureFullAnalysisMarkdown(
  deterministic: string,
  options: ReportAiOptions
): Promise<{ markdown: string; model: string; skipped?: string }> {
  const providers = reportProviders(options)
  if (providers.length === 0) {
    return {
      markdown: deterministic,
      model: 'deterministic',
      skipped: 'No NVIDIA or OpenAI-compatible API key configured; wrote the complete local evidence Markdown.'
    }
  }
  const prompt =
    deterministic.length > MAX_PROMPT_CHARS
      ? `${deterministic.slice(0, MAX_PROMPT_CHARS)}\n\n[Truncated for model input; the appendix in the final file still has the full dump.]`
      : deterministic
  const messages = [
    { role: 'system' as const, content: SYSTEM },
    {
      role: 'user' as const,
      content: redactSecrets(
        `Write a reconstruction brief for Cursor/Claude Code. Keep YAML front matter and the process timeline. Summarize architecture and a rebuild plan from evidence only. Do not invent files or APIs. Do not repeat every inventory row; a complete appendix will be attached after your output.\n\n${prompt}`
      )
    }
  ]
  const failures: string[] = []
  for (const provider of providers) {
    try {
      const completed = await nvidiaCompleteMarkdown(messages, {
        apiKey: provider.apiKey,
        model: provider.model,
        chatUrl: provider.chatUrl,
        includeNvidiaTemplate: provider.includeNvidiaTemplate,
        fetchImpl: options.fetchImpl,
        sleep: options.sleep,
        maxContinues: 4,
        maxRetries: 3,
        maxTokens: 4096,
        timeoutMs: 90_000,
        idleTimeoutMs: 25_000
      })
      if (!completed.content.trim()) {
        failures.push(`${provider.name} returned an empty document`)
        continue
      }
      return {
        markdown: mergeStructuredMarkdown(options.appendix ?? deterministic, completed.content),
        model: completed.model
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      failures.push(`${provider.name} failed (${reason.slice(0, 180)})`)
    }
  }
  return {
    markdown: deterministic,
    model: 'deterministic',
    skipped: `${failures.join('; ')}; kept the local evidence Markdown.`
  }
}
