import type { EmailResult } from '@stacksjs/types'
import { describe, expect, test } from 'bun:test'
import { capError, classifyDelivery } from '../../app/Invites/invites'

/**
 * Whether an invite email actually went out.
 *
 * The invite route reported success to the owner whatever the transport did,
 * because `mail.send()` RESOLVES with `{ success: false }` for a suppressed
 * address or a driver rejection and only throws on an exception. The `.catch()`
 * that guarded the send was therefore dead code for the ordinary failure mode,
 * and an owner saw "invited" whether or not anything left the building.
 *
 * `classifyDelivery` is where that contract is now stated once, so these tests
 * are the thing standing between us and re-learning it.
 */

function result(over: Partial<EmailResult>): EmailResult {
  return { message: '', success: false, provider: 'test', ...over }
}

describe('classifyDelivery', () => {
  test('a successful send is sent, with no error', () => {
    expect(classifyDelivery(result({ success: true }))).toEqual({ status: 'sent', error: null })
  })

  // The regression this whole feature exists for: mail.send() resolving with
  // success:false is a FAILURE. Reading it as anything else is what told owners
  // an invite had been sent when nothing left the building.
  test('a resolved failure is failed, not sent', () => {
    expect(classifyDelivery(result({ success: false, message: 'suppressed:bounce' }))).toEqual({
      status: 'failed',
      error: 'suppressed:bounce',
    })
  })

  test('a thrown error is failed and keeps its message', () => {
    expect(classifyDelivery(null, new Error('ECONNREFUSED smtp:587'))).toEqual({
      status: 'failed',
      error: 'ECONNREFUSED smtp:587',
    })
  })

  test('a non-Error throw is still classified', () => {
    expect(classifyDelivery(null, 'socket closed')).toEqual({ status: 'failed', error: 'socket closed' })
  })

  test('no result at all is failed rather than silently sent', () => {
    expect(classifyDelivery(null).status).toBe('failed')
  })

  test('a failure with no message still explains itself', () => {
    expect(classifyDelivery(result({ success: false })).error).toBe('The mail transport did not report success.')
  })
})

describe('capError', () => {
  test('keeps a short reason intact', () => {
    expect(capError('Mailbox unavailable')).toBe('Mailbox unavailable')
  })

  // delivery_error is varchar(500) and is rendered to the owner, so a stack
  // trace must neither abort the insert nor land on the settings page.
  test('drops everything after the first line', () => {
    expect(capError('Connection refused\n    at Socket.emit\n    at TCP.done')).toBe('Connection refused')
  })

  test('fits the column', () => {
    const capped = capError('x'.repeat(900))
    expect(capped.length).toBe(500)
    expect(capped.endsWith('…')).toBe(true)
  })

  test('an empty reason is never stored blank', () => {
    expect(capError('   ')).toBe('Unknown error.')
  })
})
