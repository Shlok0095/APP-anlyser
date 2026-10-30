import { describe, expect, it } from 'vitest'
import { nvidiaCompleteMarkdown, parseNvidiaSse } from '../../src/ai/nvidia'
import { structureFullAnalysisMarkdown } from '../../src/ai/full-report'
import { redactSecrets } from '../../src/main/reports/full-markdown'

function sse(parts: Array<{ content?: string; finish?: string | null }>): string {
  return parts
    .map(
      (part, index) =>
        `data: ${JSON.stringify({
          choices: [
            {
              index: 0,
              delta: { content: part.content ?? '' },
              finish_reason: part.finish ?? (index === parts.length - 1 ? 'stop' : null)
            }
          ]
        })}`
    )
    .concat('data: [DONE]')
    .join('\n')
}

describe('NVIDIA markdown client', () => {
  it('parses streamed content and ignores keepalives', () => {
    const parsed = parseNvidiaSse(
      'data: {"choices":[{"delta":{"content":"# Title\\n"}}]}\ndata: {not json}\ndata: [DONE]\n'
    )
    expect(parsed.content).toBe('# Title\n')
  })

  it('continues when finish_reason is length', async () => {
    let calls = 0
    const fetchImpl: typeof fetch = async () => {
      calls += 1
      const body =
        calls === 1
          ? sse([{ content: '# One\n', finish: 'length' }])
          : sse([{ content: '## Two\n', finish: 'stop' }])
      return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
    }
    const result = await nvidiaCompleteMarkdown([{ role: 'user', content: 'Write markdown' }], {
      apiKey: 'nvapi-test',
      fetchImpl,
      sleep: async () => undefined,
      maxContinues: 3,
      maxRetries: 1
    })
    expect(result.content).toBe('# One\n## Two')
    expect(calls).toBe(2)
  })

  it('retries 429 then succeeds', async () => {
    let calls = 0
    const fetchImpl: typeof fetch = async () => {
      calls += 1
      if (calls === 1) {
        return new Response('rate', { status: 429 })
      }
      return new Response(sse([{ content: 'OK', finish: 'stop' }]), { status: 200 })
    }
    const result = await nvidiaCompleteMarkdown([{ role: 'user', content: 'x' }], {
      apiKey: 'nvapi-test',
      fetchImpl,
      sleep: async () => undefined
    })
    expect(result.content).toBe('OK')
    expect(calls).toBe(2)
  })

  it('falls back to the local dump when no key is set', async () => {
    const structured = await structureFullAnalysisMarkdown('# evidence', { apiKey: '' })
    expect(structured.model).toBe('deterministic')
    expect(structured.markdown).toContain('# evidence')
    expect(structured.skipped).toMatch(/No NVIDIA or OpenAI-compatible/)
  })

  it('uses an OpenAI-compatible URL when NVIDIA is not configured', async () => {
    let usedUrl = ''
    const fetchImpl: typeof fetch = async (input) => {
      usedUrl = String(input)
      return new Response(sse([{ content: '# OpenAI\n', finish: 'stop' }]), { status: 200 })
    }
    const structured = await structureFullAnalysisMarkdown('# evidence', {
      openaiApiKey: 'sk-test',
      openaiBaseUrl: 'https://api.openai.com/v1',
      openaiModel: 'gpt-4.1',
      appendix: '# evidence\nappendix',
      fetchImpl,
      sleep: async () => undefined
    })
    expect(usedUrl).toBe('https://api.openai.com/v1/chat/completions')
    expect(structured.model).not.toBe('deterministic')
    expect(structured.markdown).toContain('# OpenAI')
  })

  it('redacts NVIDIA keys from report text', () => {
    expect(redactSecrets('token nvapi-abcDEF123 and Bearer xyz.abc')).toContain('[REDACTED]')
    expect(redactSecrets('token nvapi-abcDEF123')).not.toContain('nvapi-abcDEF123')
  })
})
