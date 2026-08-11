import { mail } from '@stacksjs/email'
import { ingestUrl } from '../Support/urls'

/**
 * Project invitations. An owner invites a teammate by email; we store a pending
 * invite with a secret token and email them a join link. The recipient signs up
 * or logs in, then accepts from a banner in the app — at which point the invite
 * becomes an active membership.
 *
 * Email is best-effort (fire-and-forget from the route). Locally the mail driver
 * is `log`, so the link won't actually be delivered — the invite API also
 * returns the join URL so the owner can copy/share it directly.
 */

// The base that actually serves `/join/{token}` — the route is registered in
// routes/projects.ts, which is the API server. In production this is APP_URL,
// the same origin the web app is on, so this is identical to what it was; in
// local dev it is the API port, where appUrl() pointed at the web port and the
// link 404'd. Every invite link the UI copied out, and every one emailed, was
// dead locally: the recipient could never open what they were sent.
const JOIN_BASE = ingestUrl()

export function joinUrl(token: string): string {
  return `${JOIN_BASE}/join/${encodeURIComponent(token)}`
}

/** A hard-to-guess invite token that backs the join link. */
export function newInviteToken(): string {
  return `inv_${(globalThis.crypto.randomUUID() + globalThis.crypto.randomUUID()).replace(/-/g, '')}`
}

export async function sendInviteEmail(email: string, projectName: string, token: string, inviterName?: string): Promise<void> {
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

  await mail.send({ to: email, subject, text, html })
}

function escapeHtml(value: string): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
