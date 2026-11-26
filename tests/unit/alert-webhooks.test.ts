import { afterEach, describe, expect, mock, test } from 'bun:test'
import { sendTestAlert, validateWebhook } from '../../app/Errors/channels'

const url = 'https://discord.com/api/webhooks/123456789012345678/example-token'
const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

describe('Discord alert webhooks', () => {
  test('require the webhook ID and token', () => {
    expect(validateWebhook('discord', url).ok).toBe(true)
    expect(validateWebhook('discord', url.replace('/api/', '/api/v10/')).ok).toBe(true)
    expect(validateWebhook('discord', url.slice(0, url.lastIndexOf('/'))).ok).toBe(false)
    expect(validateWebhook('discord', url.replace('/123456789012345678/', '/test/')).ok).toBe(false)
  })

  test('retries Discord rate limiting and accepts a successful second request', async () => {
    const request = mock(async () => new Response(null, { status: 204 }))
    request.mockImplementationOnce(async () => new Response(null, {
      status: 429,
      headers: { 'Retry-After': '0' },
    }))
    globalThis.fetch = request as unknown as typeof fetch
    expect(await sendTestAlert('discord', url, 'HQ.training API')).toBe(true)
    expect(request).toHaveBeenCalledTimes(2)
  })

  test('makes no request for malformed URLs and does not retry revoked webhooks', async () => {
    const request = mock(async () => new Response(null, { status: 404 }))
    globalThis.fetch = request as unknown as typeof fetch
    expect(await sendTestAlert('discord', url.replace('/example-token', ''), 'HQ.training API')).toBe(false)
    expect(request).toHaveBeenCalledTimes(0)
    expect(await sendTestAlert('discord', url, 'HQ.training API')).toBe(false)
    expect(request).toHaveBeenCalledTimes(1)
  })
})
