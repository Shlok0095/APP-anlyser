import { spawn } from 'node:child_process'
import { createWriteStream, existsSync } from 'node:fs'
import { delimiter, join } from 'node:path'
import type { CommandOptions, CommandResult } from '../../shared/types/engine'

const DEFAULT_MAX_STDOUT = 16_000_000

export async function runCommand(
  file: string,
  args: string[],
  options?: CommandOptions
): Promise<CommandResult> {
  return await new Promise((resolve) => {
    const child = spawn(file, args, {
      cwd: options?.cwd,
      env: options?.env ?? process.env,
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    let stdout = ''
    let stderr = ''
    let timedOut = false
    let settled = false
    let lineBuffer = ''
    const maxBytes = options?.maxStdoutBytes ?? DEFAULT_MAX_STDOUT
    const stream = options?.stdoutPath
      ? createWriteStream(options.stdoutPath, { encoding: 'utf8' })
      : null
    const timeout = setTimeout(() => {
      timedOut = true
      child.kill()
    }, options?.timeoutMs ?? 30_000)

    const finish = (code: number | null): void => {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(timeout)
      if (stream) {
        stream.end()
      }
      if (options?.onStdoutLine && lineBuffer.trim()) {
        options.onStdoutLine(lineBuffer.trim())
      }
      resolve({ code, stdout, stderr, timedOut })
    }

    child.stdout.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf8')
      if (stream) {
        stream.write(chunk)
      }
      if (stdout.length < maxBytes) {
        stdout += text
        if (stdout.length > maxBytes) {
          stdout = stdout.slice(0, maxBytes)
        }
      }
      if (options?.onStdoutLine) {
        lineBuffer += text
        const parts = lineBuffer.split(/\r?\n/)
        lineBuffer = parts.pop() ?? ''
        for (const line of parts) {
          const trimmed = line.trim()
          if (trimmed) {
            options.onStdoutLine(trimmed)
          }
        }
      }
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8')
      if (stderr.length > 1_000_000) {
        stderr = stderr.slice(0, 1_000_000)
      }
    })
    child.on('error', (error) => {
      stderr = stderr ? `${stderr}\n${error.message}` : error.message
      finish(null)
    })
    child.on('close', (code) => {
      finish(code)
    })
  })
}

export function findOnPath(name: string): string | null {
  const extensions = process.platform === 'win32' ? ['', '.exe', '.cmd', '.bat'] : ['']
  const parts = (process.env.PATH ?? '').split(delimiter)
  for (const dir of parts) {
    for (const ext of extensions) {
      const candidate = join(dir, `${name}${ext}`)
      if (existsSync(candidate)) {
        return candidate
      }
    }
  }
  return null
}
