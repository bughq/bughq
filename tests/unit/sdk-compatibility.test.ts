import { describe, expect, test } from 'bun:test'
import contracts from '../fixtures/sdk-ingest-contracts.json'
import { buildMetadata, parseIngestEnvelope } from '../../app/Errors/payload'

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
})
