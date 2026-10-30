import { describe, expect, it } from 'vitest'
import { getContentSecurityPolicy } from '../../src/main/security/csp'

describe('Content-Security-Policy', () => {
  it('keeps production policy strict', () => {
    const csp = getContentSecurityPolicy(false)
    expect(csp).toContain("script-src 'self'")
    expect(csp).not.toContain('unsafe-eval')
    expect(csp).toContain("object-src 'none'")
  })

  it('allows Vite HMR only in development', () => {
    const csp = getContentSecurityPolicy(true)
    expect(csp).toContain('unsafe-eval')
    expect(csp).toContain('ws://localhost:*')
  })
})
