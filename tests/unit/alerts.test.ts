import { describe, expect, test } from 'bun:test'
import { alertRecipients } from '../../app/Errors/alerts'

/**
 * Who gets told about an issue.
 *
 * `notifyIssueOpened` emailed the project owner and nobody else. You could
 * invite a teammate specifically to help triage and they would never learn an
 * issue had happened — the feature looked complete from the owner's side and
 * did nothing for the person it was for.
 *
 * The recipient list is a pure function so the part that was actually wrong —
 * the decision about who is on it — can be pinned down without a database or a
 * mail transport.
 */

describe('alertRecipients', () => {
  test('includes members, not just the owner', () => {
    expect(alertRecipients('owner@x.test', ['a@x.test', 'b@x.test'])).toEqual([
      { email: 'owner@x.test', role: 'owner' },
      { email: 'a@x.test', role: 'member' },
      { email: 'b@x.test', role: 'member' },
    ])
  })

  test('a project with no members still alerts the owner', () => {
    expect(alertRecipients('owner@x.test', [])).toEqual([{ email: 'owner@x.test', role: 'owner' }])
  })

  // The invite route refuses to invite the owner, so this should not arise —
  // but that rule lives in a different file and the cost of it being wrong is a
  // duplicate alert. Dedupe here makes it impossible rather than unlikely.
  test('the owner is never listed twice, whatever the casing', () => {
    expect(alertRecipients('Owner@X.test', ['owner@x.test'])).toEqual([
      { email: 'Owner@X.test', role: 'owner' },
    ])
  })

  test('duplicate members collapse to one recipient', () => {
    expect(alertRecipients(null, ['a@x.test', 'A@X.TEST'])).toEqual([
      { email: 'a@x.test', role: 'member' },
    ])
  })

  // A project whose owner row is missing (deleted user) must still alert its
  // members rather than returning nothing, which is what a JOIN-based query
  // would have done.
  test('members are alerted even with no owner', () => {
    expect(alertRecipients(null, ['a@x.test'])).toEqual([{ email: 'a@x.test', role: 'member' }])
  })

  test('blank and missing addresses are dropped, not sent to', () => {
    expect(alertRecipients('  ', ['', null, undefined, ' b@x.test '])).toEqual([
      { email: 'b@x.test', role: 'member' },
    ])
  })

  test('nobody to email is an empty list, not a crash', () => {
    expect(alertRecipients(null, [])).toEqual([])
  })
})
