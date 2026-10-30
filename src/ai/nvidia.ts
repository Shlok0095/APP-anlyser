import {
  NVIDIA_CHAT_URL,
  NVIDIA_FALLBACK_MODEL,
  NVIDIA_PRIMARY_MODEL
} from '../shared/nvidia'

export {
  NVIDIA_CHAT_URL,
  NVIDIA_FALLBACK_MODEL,
  NVIDIA_MODELS,
  NVIDIA_PRIMARY_MODEL
} from '../shared/nvidia'

export interface NvidiaChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface NvidiaChatResult {
  content: string
  finishReason: string | null
  model: string
  attempts: number
}

export interface NvidiaClientOptions {
  apiKey: string
  model?: string
  chatUrl?: string
  includeNvidiaTemplate?: boolean
  fetchImpl?: typeof fetch
  sleep?: (ms: number) => Promise<void>
  timeoutMs?: number
  idleTimeoutMs?: number
  maxRetries?: number
  maxContinues?: number
  maxTokens?: number
  signal?: AbortSignal
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function parseNvidiaSse(raw: string): { content: string; finishReason: string | null } {
  let content = ''
  let finishReason: string | null = null
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('data:')) {
      continue
    }
    const payload = trimmed.slice(5).trim()
    if (!payload || payload === '[DONE]') {
      continue
    }
    try {
      const event = JSON.parse(payload) as {
        choices?: Array<{
          finish_reason?: string | null
          delta?: { content?: string | null }
          message?: { content?: string | null }
        }>
      }
      const choice = event.choices?.[0]
      if (choice?.delta?.content) {
        content += choice.delta.content
      } else if (choice?.message?.content) {
        content += choice.message.content
      }
      if (choice?.finish_reason) {
        finishReason = choice.finish_reason
      }
    } catch {
      continue
    }
  }
  return { content, finishReason }
}

function errorStatusRetryable(status: number): boolean {
  return status === 429 || status >= 500
}

async function readWithIdle<T>(promise: Promise<T>, idleMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('NVIDIA stream idle timeout')), idleMs)
      })
    ])
  } finally {
    if (timer) {
      clearTimeout(timer)
    }
  }
}

async function readSseResponse(
  response: Response,
  idleMs: number
): Promise<{ content: string; finishReason: string | null; raw: string }> {
  if (!response.body) {
    const raw = await response.text()
    const parsed = parseNvidiaSse(raw)
    return { content: parsed.content, finishReason: parsed.finishReason, raw }
  }
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let raw = ''
  let content = ''
  let finishReason: string | null = null
  try {
    while (true) {
      const chunk = await readWithIdle(reader.read(), idleMs)
      if (chunk.done) {
        break
      }
      const text = decoder.decode(chunk.value, { stream: true })
      raw += text
      buffer += text
      const lines = buffer.split(/\r?\n/)
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed.startsWith('data:')) {
          continue
        }
        const payload = trimmed.slice(5).trim()
        if (payload === '[DONE]') {
          return { content, finishReason: finishReason ?? 'stop', raw }
        }
        try {
          const event = JSON.parse(payload) as {
            choices?: Array<{
              finish_reason?: string | null
              delta?: { content?: string | null }
            }>
          }
          const choice = event.choices?.[0]
          if (choice?.delta?.content) {
            content += choice.delta.content
          }
          if (choice?.finish_reason) {
            finishReason = choice.finish_reason
          }
        } catch {
          continue
        }
      }
    }
  } finally {
    reader.releaseLock()
  }
  if (buffer.trim()) {
    const parsed = parseNvidiaSse(buffer)
    content += parsed.content
    finishReason = parsed.finishReason ?? finishReason
  }
  return { content, finishReason, raw }
}

async function postChat(
  options: NvidiaClientOptions,
  model: string,
  messages: NvidiaChatMessage[]
): Promise<{ status: number; content: string; finishReason: string | null; body: string }> {
  const fetchImpl = options.fetchImpl ?? fetch
  const timeoutMs = options.timeoutMs ?? 90_000
  const idleMs = options.idleTimeoutMs ?? 25_000
  const signals = [AbortSignal.timeout(timeoutMs)]
  if (options.signal) {
    signals.push(options.signal)
  }
  const payload: Record<string, unknown> = {
    model,
    messages,
    temperature: 0.2,
    top_p: 0.9,
    max_tokens: options.maxTokens ?? 4096,
    stream: true
  }
  if (options.includeNvidiaTemplate !== false) {
    payload.chat_template_kwargs = { enable_thinking: false }
  }
  const response = await fetchImpl(options.chatUrl ?? NVIDIA_CHAT_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${options.apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'text/event-stream'
    },
    body: JSON.stringify(payload),
    signal: signals.length > 1 ? AbortSignal.any(signals) : signals[0]
  })
  if (!response.ok) {
    const body = await response.text()
    return { status: response.status, content: '', finishReason: null, body }
  }
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const parsed = await Promise.race([
      readSseResponse(response, idleMs),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('NVIDIA response timeout')), timeoutMs)
      })
    ])
    return {
      status: response.status,
      content: parsed.content,
      finishReason: parsed.finishReason,
      body: parsed.raw
    }
  } finally {
    if (timer) {
      clearTimeout(timer)
    }
  }
}

export async function nvidiaCompleteMarkdown(
  messages: NvidiaChatMessage[],
  options: NvidiaClientOptions
): Promise<NvidiaChatResult> {
  const sleep = options.sleep ?? defaultSleep
  const maxRetries = options.maxRetries ?? 3
  const maxContinues = options.maxContinues ?? 4
  const models = [
    options.model && options.model.trim() ? options.model.trim() : NVIDIA_PRIMARY_MODEL,
    NVIDIA_FALLBACK_MODEL
  ].filter((item, index, list) => list.indexOf(item) === index)

  let model = models[0]
  let attempts = 0
  let assembled = ''
  const seed = [...messages]

  for (let continuation = 0; continuation < maxContinues; continuation += 1) {
    const turnMessages: NvidiaChatMessage[] =
      continuation === 0
        ? seed
        : [
            ...seed,
            { role: 'assistant', content: assembled },
            {
              role: 'user',
              content:
                'Continue exactly from where you stopped. Do not repeat previous markdown. Keep the same headings and complete any unfinished list, table, or code fence.'
            }
          ]

    let lastError = ''
    let done = false
    for (let retry = 0; retry <= maxRetries; retry += 1) {
      attempts += 1
      try {
        const posted = await postChat(options, model, turnMessages)
        if (posted.status === 404 || posted.status === 410) {
          const nextModel = models.find((item) => item !== model)
          if (nextModel) {
            model = nextModel
            lastError = `HTTP ${posted.status}`
            continue
          }
        }
        if (!posted.status || posted.status >= 400) {
          lastError = `HTTP ${posted.status}: ${posted.body.slice(0, 180)}`
          if (errorStatusRetryable(posted.status) && retry < maxRetries) {
            await sleep(1000 * 2 ** retry)
            continue
          }
          throw new Error(lastError)
        }
        assembled += posted.content
        if (posted.finishReason === 'length') {
          done = false
        } else {
          done = true
        }
        lastError = ''
        break
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error)
        const retryable =
          /HTTP 429|HTTP 5|aborted|timeout|network|fetch|ECONN|UND_ERR/i.test(lastError)
        if (retryable && retry < maxRetries) {
          await sleep(1000 * 2 ** retry)
          continue
        }
        throw new Error(lastError)
      }
    }
    if (lastError) {
      throw new Error(lastError)
    }
    if (done) {
      break
    }
  }

  return { content: assembled.trim(), finishReason: 'stop', model, attempts }
}
