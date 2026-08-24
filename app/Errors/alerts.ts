import { db } from '@stacksjs/database'
import { mail } from '@stacksjs/email'
import { appUrl } from '../Support/urls'
import { notifyChannels } from './channels'

/**
 * Issue alerts. Fired by the ingest for the two moments worth a human's
 * attention: an issue's FIRST occurrence, and a resolved issue coming back
 * (regression). Repeat occurrences only bump the counter and never alert, so
 * an error storm produces exactly one message.
 *
 * `dispatchAlerts` fans a single alert out to every destination — every person
 * on the project plus any Slack/Discord channels. Alerts are best-effort:
 * callers fire-and-forget so a slow or failing transport can never delay or
 * break the ingest path.
 */

const DASHBOARD_BASE = appUrl()

export type AlertKind = 'new' | 'regression'

export interface AlertIssue {
  id: string
  title: string
  culprit?: string | null
  level?: string | null
  environment?: string | null
  count?: number
}

/** Who an alert goes to, and why they are getting it. */
export interface AlertRecipient {
  email: string
  role: 'owner' | 'member'
}

/**
 * Build the recipient list for a project.
 *
 * Pure, and exported for that reason: the interesting behaviour here is the
 * de-duplication and precedence, and neither should need a database or a mail
 * transport to test.
 *
 * The owner always comes first and always wins a tie. `project_members` is
 * keyed by email with a unique index on `(project_id, lower(email))`, and the
 * invite route already refuses to invite the owner — but "already refuses" is a
 * rule enforced somewhere else, and the cost of it being wrong is a teammate
 * getting the same alert twice. Deduping here makes that impossible rather than
 * unlikely.
 */
export function alertRecipients(ownerEmail: string | null | undefined, memberEmails: Array<string | null | undefined>): AlertRecipient[] {
  const out: AlertRecipient[] = []
  const seen = new Set<string>()
  const add = (raw: string | null | undefined, role: AlertRecipient['role']): void => {
    const email = String(raw ?? '').trim()
    const key = email.toLowerCase()
    if (!email || seen.has(key))
      return
    seen.add(key)
    out.push({ email, role })
  }
  add(ownerEmail, 'owner')
  for (const email of memberEmails)
    add(email, 'member')
  return out
}

/**
 * Email everyone on the project about an issue.
 *
 * One message per recipient rather than one message with many addresses. Two
 * reasons, and the first is the important one: a shared To/Cc header would
 * disclose the whole team's email addresses to every member, which is a privacy
 * leak the feature has no reason to introduce. The second is that per-recipient
 * sends fail independently, so one dead address cannot suppress everyone else's
 * alert.
 *
 * Members were previously not emailed at all — only the project owner was. You
 * could invite a teammate specifically to help triage and they would never learn
 * an issue had happened.
 */
export async function notifyIssueOpened(projectId: string, issue: AlertIssue, kind: AlertKind): Promise<void> {
  const project = (await db.unsafe(
    `SELECT p.name AS project_name, u.email AS owner_email
     FROM projects p LEFT JOIN users u ON u.id = p.owner_id
     WHERE p.id = $1 LIMIT 1`,
    [projectId],
  ))?.[0]
  if (!project)
    return

  const memberRows = (await db.unsafe(
    'SELECT email FROM project_members WHERE project_id = $1 ORDER BY created_at ASC NULLS LAST, email',
    [projectId],
  )) ?? []

  const recipients = alertRecipients(project.owner_email, memberRows.map((m: any) => m.email))
  if (recipients.length === 0)
    return

  const projectName = project.project_name || projectId
  const message = buildIssueAlert(projectName, issue, kind)

  const results = await Promise.allSettled(recipients.map(async (recipient) => {
    // `mail.send()` resolves with `{ success: false }` for a suppressed address
    // or a driver rejection and only throws on an exception, so the result has
    // to be inspected — a bare await would report every failure as a success.
    const result = await mail.send({
      to: recipient.email,
      subject: message.subject,
      text: message.text,
      html: message.html(recipient.role, projectName),
    })
    if (!result?.success)
      throw new Error(result?.message || 'transport did not report success')
  }))

  const failed = results.filter(r => r.status === 'rejected').length
  if (failed)
    console.error(`[alerts] ${failed}/${recipients.length} issue alert(s) for ${projectId} were not delivered`)
}

interface RenderedAlert {
  subject: string
  text: string
  html: (role: AlertRecipient['role'], projectName: string) => string
}

/**
 * Render the alert once and reuse it across recipients. Only the footer differs
 * per person — everything above it is the same issue — so the html is a function
 * of the role rather than a whole second render.
 */
function buildIssueAlert(projectName: string, issue: AlertIssue, kind: AlertKind): RenderedAlert {
  const url = `${DASHBOARD_BASE}/issue/${issue.id}`
  const heading = kind === 'regression' ? 'Regression' : 'New issue'
  const subject = `[bughq] ${heading} in ${projectName}: ${issue.title}`

  const facts: Array<[string, string]> = [
    ['Project', projectName],
    ['Level', String(issue.level || 'error')],
  ]
  if (issue.culprit)
    facts.push(['Where', String(issue.culprit)])
  if (issue.environment)
    facts.push(['Environment', String(issue.environment)])
  if (kind === 'regression' && issue.count)
    facts.push(['Occurrences', String(issue.count)])

  const intro = kind === 'regression'
    ? 'An issue you resolved is happening again.'
    : 'A new issue was just captured.'

  const text = [
    intro,
    '',
    issue.title,
    ...facts.map(([k, v]) => `${k}: ${v}`),
    '',
    `View it: ${url}`,
  ].join('\n')

  const rows = facts
    .map(([k, v]) => `<tr><td style="padding:4px 12px 4px 0;color:#667085;white-space:nowrap">${escapeHtml(k)}</td><td style="padding:4px 0;color:#0b0f19">${escapeHtml(v)}</td></tr>`)
    .join('')

  const html = (role: AlertRecipient['role'], name: string): string => {
    // The old footer said "because you own" to everyone, which is now wrong for
    // most recipients — and a member reading it would have no idea why they were
    // being emailed or how to make it stop.
    const because = role === 'owner'
      ? `You get this because you own ${escapeHtml(name)} on bughq.`
      : `You get this because you are a member of ${escapeHtml(name)} on bughq. Its owner can remove you from the project.`
    return `
<div style="font-family:ui-sans-serif,system-ui,sans-serif;max-width:520px;margin:0 auto;padding:24px 16px;color:#0b0f19">
  <p style="margin:0 0 12px;font-size:14px;color:#4b5565">${escapeHtml(intro)}</p>
  <p style="margin:0 0 16px;font-size:16px;font-weight:600">${escapeHtml(issue.title)}</p>
  <table style="border-collapse:collapse;font-size:13px;margin-bottom:20px">${rows}</table>
  <a href="${url}" style="display:inline-block;background:#e11d48;color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;padding:10px 18px;border-radius:10px">Open in bughq</a>
  <p style="margin:20px 0 0;font-size:12px;color:#97a1b2">${because} Repeat occurrences of the same issue will not email you again.</p>
</div>`
  }

  return { subject, text, html }
}

/**
 * Fan a single alert out to every destination for the project: everyone on it by
 * email, and each enabled Slack/Discord channel. Each leg is independent (Promise
 * .allSettled) so one failing transport can't suppress the others, and the
 * whole thing is fire-and-forget from the ingest's perspective. Gate the CALL
 * with the per-project alert throttle (allowAlert) so this fires at most once
 * per throttle window, not once per transport.
 */
export async function dispatchAlerts(projectId: string, issue: AlertIssue, kind: AlertKind): Promise<void> {
  await Promise.allSettled([
    notifyIssueOpened(projectId, issue, kind),
    notifyChannels(projectId, issue, kind),
  ])
}

function escapeHtml(value: string): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
