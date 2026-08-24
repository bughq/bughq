import type { EmailResult } from '@stacksjs/types'
import { db } from '@stacksjs/database'
import { mail } from '@stacksjs/email'
import { ingestUrl } from '../Support/urls'

/**
 * Project invitations. An owner invites a teammate by email; we store a pending
 * invite with a secret token and email them a join link. The recipient signs up
 * or logs in, then accepts from a banner in the app — at which point the invite
 * becomes an active membership.
 *
 * Delivery is TRACKED, not assumed. See `deliverInvite`.
 */

// The base that actually serves `/join/{token}` — the route is registered in
// routes/projects.ts, which is the API server. In production this is APP_URL,
// the same origin the web app is on, so this is identical to what it was; in
// local dev it is the API port, where appUrl() pointed at the web port and the
// link 404'd. Every invite link the UI copied out, and every one emailed, was
// dead locally: the recipient could never open what they were sent.
const JOIN_BASE = ingestUrl()

/** How a delivery attempt ended. Mirrors the `delivery_status` column. */
export type DeliveryStatus = 'pending' | 'sent' | 'failed'

export interface InviteDelivery {
  status: DeliveryStatus
  /** Provider reason, capped for storage and display. Null when sent. */
  error: string | null
}

export function joinUrl(token: string): string {
  // /api/join, not /join. The public origin routes /api/* to the API server and
  // everything else to the web app, so the bare path answered the 404 page —
  // measured against bughq.org. Every invite ever sent pointed at a URL the
  // recipient could not open.
  return `${JOIN_BASE}/api/join/${encodeURIComponent(token)}`
}

/** A hard-to-guess invite token that backs the join link. */
export function newInviteToken(): string {
  return `inv_${(globalThis.crypto.randomUUID() + globalThis.crypto.randomUUID()).replace(/-/g, '')}`
}

/**
 * Classify what `mail.send()` reported.
 *
 * This exists because the contract is easy to get wrong and we got it wrong:
 * `Mail.send()` RESOLVES with `{ success: false }` when the address is on the
 * suppression list or the driver reports a rejection, and only THROWS on an
 * exception (unknown driver, socket error). Guarding a send with `.catch()`
 * alone — which is what this module used to do — therefore misses every
 * ordinary delivery failure. `sendOrFail()` is the throwing variant; we do not
 * use it because we want the reason as a value, not a stack trace.
 *
 * Pure and exported so the mapping is testable without a mail transport.
 */
export function classifyDelivery(result: EmailResult | null, thrown?: unknown): InviteDelivery {
  if (thrown) {
    const message = thrown instanceof Error ? thrown.message : String(thrown)
    return { status: 'failed', error: capError(message) }
  }
  if (!result || result.success !== true)
    return { status: 'failed', error: capError(result?.message || 'The mail transport did not report success.') }
  return { status: 'sent', error: null }
}

/**
 * Fits `delivery_error` (varchar(500)) and keeps a stack trace off the page.
 *
 * 499 + the ellipsis is exactly 500. Postgres counts varchar in characters, not
 * bytes, so the 3-byte ellipsis still costs one.
 */
export function capError(message: string): string {
  const first = String(message).split('\n')[0].trim()
  return first.length > 500 ? `${first.slice(0, 499)}…` : (first || 'Unknown error.')
}

/**
 * Send the invite email and report what happened. Does not touch the database —
 * `deliverInvite` is the one that records the outcome.
 */
export async function sendInviteEmail(email: string, projectName: string, token: string, inviterName?: string): Promise<InviteDelivery> {
  const url = joinUrl(token)
  const who = inviterName ? `${inviterName} invited you` : 'You have been invited'
  const subject = `You're invited to ${projectName} on bughq`
  const text = [
    `${who} to collaborate on ${projectName} on bughq.`,
    '',
    `Join here: ${url}`,
    '',
    `If you don't have a bughq account yet, you'll be able to create one — just use this email address (${email}).`,
  ].join('\n')

  const html = `
<div style="font-family:ui-sans-serif,system-ui,sans-serif;max-width:520px;margin:0 auto;padding:24px 16px;color:#0b0f19">
  <p style="margin:0 0 6px;font-size:14px;color:#4b5565">${escapeHtml(who)} to collaborate on</p>
  <p style="margin:0 0 16px;font-size:20px;font-weight:700;letter-spacing:-0.02em">${escapeHtml(projectName)}</p>
  <a href="${url}" style="display:inline-block;background:#e11d48;color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;padding:11px 20px;border-radius:10px">Join ${escapeHtml(projectName)}</a>
  <p style="margin:20px 0 0;font-size:12px;color:#97a1b2">If you don't have a bughq account yet, you'll create one on the next screen — sign up with <span style="color:#4b5565">${escapeHtml(email)}</span>. If you weren't expecting this, you can ignore this email.</p>
</div>`

  try {
    const result = await mail.send({ to: email, subject, text, html })
    return classifyDelivery(result)
  }
  catch (err) {
    return classifyDelivery(null, err)
  }
}

/**
 * Send the invite and record the outcome on its row, so the owner's Members list
 * can say "sent" or "could not be delivered" instead of guessing. Never throws:
 * a failed invite email is a state to display, not a reason to fail the request
 * that created the invite — the join link still works and can be shared by hand.
 */
export async function deliverInvite(opts: {
  inviteId: string
  email: string
  projectName: string
  token: string
  inviterName?: string
}): Promise<InviteDelivery> {
  const delivery = await sendInviteEmail(opts.email, opts.projectName, opts.token, opts.inviterName)
  try {
    await db.unsafe(
      `UPDATE project_invites
         SET delivery_status = $1, delivery_error = $2, delivered_at = $3
       WHERE id = $4`,
      [delivery.status, delivery.error, delivery.status === 'sent' ? new Date().toISOString() : null, opts.inviteId],
    )
  }
  catch (err) {
    // The email may well have gone out; only the bookkeeping failed. Log it
    // rather than reporting a delivery failure that did not happen.
    console.error('[invite] could not record delivery status:', err instanceof Error ? err.message : err)
  }
  return delivery
}

function escapeHtml(value: string): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
