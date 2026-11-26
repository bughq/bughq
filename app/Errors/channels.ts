import { db } from '@stacksjs/database'
import { appUrl } from '../Support/urls'

/**
 * Chat alert delivery: Slack and Discord incoming webhooks.
 *
 * A project owner adds a webhook URL in settings; when an issue opens for the
 * first time or a resolved one regresses, the ingest fans the same alert out to
 * every enabled channel (alongside the owner email). Delivery is best-effort —
 * callers fire-and-forget so a slow or failing webhook never touches the ingest
 * path — and gated by the per-project alert throttle upstream, so a flood can't
 * turn into a chat-spam bomb.
 */

const DASHBOARD_BASE = appUrl()

export type ChannelType = 'slack' | 'discord'
export type AlertKind = 'new' | 'regression'

export interface ChannelIssue {
  id: string
  title: string
  culprit?: string | null
  level?: string | null
  environment?: string | null
  count?: number
}

// SSRF guard. These webhook URLs are POSTed server-side, so an attacker who
// could store an arbitrary URL would turn bughq into a request proxy into our
// own network. Accept only the real provider hosts over https, and for Discord
// only the webhook path. Validated on write (the API) AND before every send.
const DISCORD_HOSTS = new Set([
  'discord.com',
  'discordapp.com',
  'canary.discord.com',
  'ptb.discord.com',
])

export function validateWebhook(type: string, rawUrl: string): { ok: boolean, error?: string } {
  let url: URL
  try {
    url = new URL(rawUrl)
  }
  catch {
    return { ok: false, error: 'That does not look like a valid URL.' }
  }
  if (url.protocol !== 'https:')
    return { ok: false, error: 'Webhook URL must use https.' }
  if (url.username || url.password || url.port || url.hash)
    return { ok: false, error: 'Paste the provider’s incoming-webhook URL.' }

  if (type === 'slack') {
    if (url.hostname !== 'hooks.slack.com')
      return { ok: false, error: 'Slack webhooks must be a hooks.slack.com URL.' }
    if (!url.pathname.startsWith('/services/'))
      return { ok: false, error: 'That is not a Slack incoming-webhook URL.' }
    return { ok: true }
  }
  if (type === 'discord') {
    if (!DISCORD_HOSTS.has(url.hostname))
      return { ok: false, error: 'Discord webhooks must be a discord.com URL.' }
    if (!/^\/api\/(?:v\d+\/)?webhooks\/\d+\/[A-Za-z0-9._-]+\/?$/.test(url.pathname))
      return { ok: false, error: 'That is not a Discord webhook URL.' }
    return { ok: true }
  }
  return { ok: false, error: 'Unknown channel type.' }
}

// Embed accent per alert kind (Discord wants a decimal int). New issues use the
// bughq rose; regressions use amber so a re-break reads differently at a glance.
const COLOR_NEW = 0xE11D48
const COLOR_REGRESSION = 0xF59E0B

function issueUrl(id: string): string {
  // 'test' is the sentinel id used by sendTestAlert; there's no real issue to
  // open, so send the reader to the dashboard rather than a dead link.
  if (!id || id === 'test')
    return `${DASHBOARD_BASE}/dashboard`
  return `${DASHBOARD_BASE}/issue/${id}`
}

function heading(kind: AlertKind): string {
  return kind === 'regression' ? 'Regression' : 'New issue'
}

function intro(kind: AlertKind): string {
  return kind === 'regression'
    ? 'An issue you resolved is happening again.'
    : 'A new issue was just captured.'
}

function factList(projectName: string, issue: ChannelIssue, kind: AlertKind): Array<[string, string]> {
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
  return facts
}

function slackPayload(projectName: string, issue: ChannelIssue, kind: AlertKind): unknown {
  const url = issueUrl(issue.id)
  const facts = factList(projectName, issue, kind)
  return {
    // Fallback text drives the notification/preview; blocks render the card.
    text: `[bughq] ${heading(kind)} in ${projectName}: ${issue.title}`,
    blocks: [
      { type: 'header', text: { type: 'plain_text', text: `${kind === 'regression' ? '🔁' : '🐛'} ${heading(kind)}`, emoji: true } },
      { type: 'section', text: { type: 'mrkdwn', text: `*<${url}|${slackEscape(issue.title)}>*\n${intro(kind)}` } },
      { type: 'section', fields: facts.map(([k, v]) => ({ type: 'mrkdwn', text: `*${k}*\n${slackEscape(v)}` })) },
      { type: 'actions', elements: [{ type: 'button', text: { type: 'plain_text', text: 'Open in bughq', emoji: true }, url, style: 'danger' }] },
    ],
  }
}

function discordPayload(projectName: string, issue: ChannelIssue, kind: AlertKind): unknown {
  const facts = factList(projectName, issue, kind)
  return {
    embeds: [{
      title: truncate(issue.title, 240),
      url: issueUrl(issue.id),
      description: intro(kind),
      color: kind === 'regression' ? COLOR_REGRESSION : COLOR_NEW,
      fields: facts.map(([name, value]) => ({ name, value: truncate(value, 1000) || '—', inline: name !== 'Where' })),
      footer: { text: 'bughq' },
    }],
  }
}

function buildPayload(type: ChannelType, projectName: string, issue: ChannelIssue, kind: AlertKind): unknown {
  return type === 'slack' ? slackPayload(projectName, issue, kind) : discordPayload(projectName, issue, kind)
}

// Slack mrkdwn only needs &, <, > escaped (it is not HTML).
function slackEscape(value: string): string {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function truncate(value: string, max: number): string {
  const s = String(value)
  return s.length > max ? `${s.slice(0, max - 1)}…` : s
}

function post(url: string, payload: unknown): Promise<Response> {
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(5000),
    // The SSRF allowlist only vets the URL we were given. A 3xx from (or an
    // open redirect on) an allowlisted host would otherwise bounce us to an
    // arbitrary internal target, so refuse to follow redirects at all.
    redirect: 'error',
  })
}

async function deliver(type: ChannelType, url: string, payload: unknown): Promise<Response> {
  const response = await post(url, payload)
  if (type !== 'discord' || (response.status !== 429 && response.status < 500))
    return response

  const retryAfter = response.headers.get('Retry-After')
  const delay = retryAfter === null ? 500 : Number(retryAfter) * 1000
  // Honor the provider's delay, with one bounded retry on this request path.
  if (!Number.isFinite(delay) || delay < 0 || delay > 10_000)
    return response
  await response.body?.cancel()
  await Bun.sleep(delay)
  return post(url, payload)
}

/**
 * Deliver an alert to every enabled channel on a project. Best-effort: each
 * send is independent and failures are logged with destination identifiers.
 * The caller keeps delivery off the ingest response path.
 */
export async function notifyChannels(projectId: string, issue: ChannelIssue, kind: AlertKind): Promise<void> {
  const rows = (await db.unsafe(
    `SELECT c.id, c.type, c.webhook_url, p.name AS project_name
     FROM alert_channels c JOIN projects p ON p.id = c.project_id
     WHERE c.project_id = $1 AND c.enabled = true`,
    [projectId],
  )) ?? []
  if (!rows.length)
    return
  const projectName = rows[0].project_name || projectId
  await Promise.allSettled(rows.map(async (r: any) => {
    const type = String(r.type) as ChannelType
    const url = String(r.webhook_url)
    const context = { channelId: r.id, projectId, issueId: issue.id, type, kind }
    if (!validateWebhook(type, url).ok) {
      console.warn('[alerts] Invalid chat webhook configuration', context)
      return
    }
    try {
      const response = await deliver(type, url, buildPayload(type, projectName, issue, kind))
      if (!response.ok)
        console.warn('[alerts] Chat webhook rejected delivery', { ...context, status: response.status })
      await response.body?.cancel()
    }
    catch {
      // Fetch errors can include the full webhook URL, which contains a secret.
      console.warn('[alerts] Chat webhook request failed', context)
    }
  }))
}

/**
 * Send a one-off confirmation message so the owner can verify a webhook works
 * right after adding it. Returns whether the provider accepted the POST.
 */
export async function sendTestAlert(type: ChannelType, webhookUrl: string, projectName: string): Promise<boolean> {
  const sample: ChannelIssue = {
    id: 'test',
    title: 'bughq test alert — your integration works 🎉',
    culprit: 'settings › alerts',
    level: 'info',
    environment: 'test',
  }
  try {
    if (!validateWebhook(type, webhookUrl).ok)
      return false
    const response = await deliver(type, webhookUrl, buildPayload(type, projectName, sample, 'new'))
    await response.body?.cancel()
    return response.ok
  }
  catch {
    return false
  }
}
