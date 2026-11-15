import { describe, expect, test } from 'bun:test'
import contracts from '../fixtures/sdk-ingest-contracts.json'
import { buildMetadata, headerIngestKey, parseIngestEnvelope } from '../../app/Errors/payload'

describe('SDK ingest compatibility', () => {
  for (const client of contracts.clients) {
    test(`${client.name} emits an accepted v${contracts.version} envelope`, () => {
      const parsed = parseIngestEnvelope(client.body, client.headerKey)
      expect(parsed.ok).toBe(true)
      if (!parsed.ok)
        return

      expect(parsed.value.providedKey).toBeTruthy()
      expect(parsed.value.message).toBe(client.body.message)
      expect(parsed.value.errorType).toBe(client.body.type)

      const metadata = JSON.parse(buildMetadata(client.body) || '{}')
      expect(metadata.sdk?.name).toBe(client.body.sdk.name)
    })
  }

  test('the boundary rejects an event all SDKs would be unable to display', () => {
    expect(parseIngestEnvelope({ key: 'pk_empty' })).toEqual({ ok: false, error: 'missing message' })
  })

  describe('a plain error webhook', () => {
    const headers = (values: Record<string, string>) => new Headers(values)
    // What a self-hosted tool posts when its operator points its error webhook
    // here: no SDK, no `type`, the token as a Bearer credential.
    const body = {
      message: 'runner group hq-linux is backing off: 3 launches died',
      stack: 'Error: runner group hq-linux is backing off\n    at alertOperators (app/Ops/alerts.ts:41:9)',
      traceId: '920bdc4ece9e41b8-0s',
      context: { group: 'hq-linux', launches: 3 },
      suppressed: 4,
    }

    test('is identified by its Bearer token', () => {
      expect(headerIngestKey(headers({ authorization: 'Bearer pk_webhook' }))).toBe('pk_webhook')
      expect(headerIngestKey(headers({ authorization: 'bearer   pk_webhook ' }))).toBe('pk_webhook')
      const parsed = parseIngestEnvelope(body, headerIngestKey(headers({ authorization: 'Bearer pk_webhook' })))
      expect(parsed).toMatchObject({ ok: true, value: { providedKey: 'pk_webhook', errorType: 'Error', message: body.message, stack: body.stack } })
    })

    test('never outranks the SDK header, and other credentials are not keys', () => {
      expect(headerIngestKey(headers({ 'x-bughq-key': 'pk_sdk', 'authorization': 'Bearer pk_webhook' }))).toBe('pk_sdk')
      expect(headerIngestKey(headers({ authorization: 'Basic dXNlcjpwYXNz' }))).toBeNull()
      expect(headerIngestKey(headers({ authorization: 'Bearer' }))).toBeNull()
      expect(headerIngestKey(headers({}))).toBeNull()
      expect(headerIngestKey(undefined)).toBeNull()
    })

    test('keeps its context, trace id and suppressed count on the event', () => {
      expect(JSON.parse(buildMetadata(body) || '{}')).toEqual({
        extra: { group: 'hq-linux', launches: 3, suppressed: 4 },
        tags: { trace_id: '920bdc4ece9e41b8-0s' },
      })
    })

    test('yields to what an SDK sent under the same names', () => {
      const metadata = JSON.parse(buildMetadata({ ...body, extra: { group: 'from-sdk' }, tags: { trace_id: 'from-sdk', area: 'ci' } }) || '{}')
      expect(metadata.extra).toEqual({ group: 'from-sdk', launches: 3, suppressed: 4 })
      expect(metadata.tags).toEqual({ trace_id: 'from-sdk', area: 'ci' })
    })

    test('ignores context that is not an object', () => {
      expect(buildMetadata({ message: 'x', context: ['a'], suppressed: 'many', traceId: ' ' })).toBeNull()
    })
  })
})
