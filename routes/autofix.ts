import { Auth } from '@stacksjs/auth'
import { db } from '@stacksjs/database'
import { route } from '@stacksjs/router'
import { sameOrigin } from '../app/Support/origin'
import RunAutofix from '../app/Jobs/RunAutofix'
import { parseRepository, repositoryInfo, repositoryTree } from '../app/Autofix/github'
import aiConfig from '../config/ai'

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
}

async function currentUser(request: any): Promise<any | null> {
  const header = request.headers?.get?.('authorization') ?? ''
  const token = request.bearerToken?.() ?? header.replace(/^Bearer\s+/i, '')
  if (!token) return null
  try { return await Auth.getUserFromToken(token) }
  catch { return null }
}

function userEmail(user: any): string {
  return String(user?.email ?? '').trim().toLowerCase()
}

async function issueAccess(user: any, issueId: string): Promise<any | null> {
  return (await db.unsafe(
    `SELECT i.id, i.project_id, p.repository, p.repository_branch,
            (p.owner_id = $2) AS is_owner
     FROM issues i JOIN projects p ON p.id = i.project_id
     WHERE i.id = $1 AND (
       p.owner_id = $2
       OR EXISTS (SELECT 1 FROM project_members m WHERE m.project_id = p.id AND lower(m.email) = $3)
     ) LIMIT 1`,
    [issueId, Number(user.id), userEmail(user)],
  ))?.[0] ?? null
}

async function ownerProject(user: any, projectId: string): Promise<any | null> {
  return (await db.unsafe(
    'SELECT id, repository, repository_branch FROM projects WHERE id = $1 AND owner_id = $2 LIMIT 1',
    [projectId, Number(user.id)],
  ))?.[0] ?? null
}

function parseStored(value: unknown): unknown {
  if (!value || typeof value !== 'string') return value ?? null
  try { return JSON.parse(value) }
  catch { return null }
}

function publicRun(run: any): any {
  if (!run) return null
  return {
    id: run.id,
    issue_id: run.issue_id,
    project_id: run.project_id,
    status: run.status,
    provider: run.provider,
    model: run.model,
    root_cause: run.root_cause,
    plan: parseStored(run.plan),
    changes: parseStored(run.changes),
    branch_name: run.branch_name,
    pr_url: run.pr_url,
    pr_number: run.pr_number,
    error: run.error,
    started_at: run.started_at,
    completed_at: run.completed_at,
    created_at: run.created_at,
    updated_at: run.updated_at,
  }
}

async function latestRun(issueId: string): Promise<any | null> {
  return (await db.unsafe(
    'SELECT * FROM autofix_runs WHERE issue_id = $1 ORDER BY created_at DESC LIMIT 1',
    [issueId],
  ))?.[0] ?? null
}

route.get('/api/issues/{issueId}/autofix', async (request: any) => {
  const user = await currentUser(request)
  if (!user) return json({ error: 'unauthorized' }, 401)
  const access = await issueAccess(user, request.params.issueId)
  if (!access) return json({ error: 'not found' }, 404)
  return json({
    run: publicRun(await latestRun(access.id)),
    repository: access.repository || null,
    repository_branch: access.repository_branch || null,
    can_run: !!access.is_owner,
    enabled: aiConfig.autofix.enabled,
    provider: aiConfig.default,
  })
})

route.post('/api/issues/{issueId}/autofix', async (request: any) => {
  if (!sameOrigin(request)) return json({ error: 'origin mismatch' }, 403)
  const user = await currentUser(request)
  if (!user) return json({ error: 'unauthorized' }, 401)
  const access = await issueAccess(user, request.params.issueId)
  if (!access || !access.is_owner) return json({ error: 'not found' }, 404)
  if (!aiConfig.autofix.enabled) return json({ error: 'AI Autofix is disabled.' }, 503)
  if (!access.repository) return json({ error: 'Connect a GitHub repository in project settings first.' }, 409)
  if (!process.env.GITHUB_TOKEN) return json({ error: 'GitHub access is not configured on the server.' }, 503)
  if (aiConfig.default === 'openai' && !aiConfig.drivers.openai.apiKey)
    return json({ error: 'OPENAI_API_KEY is not configured on the server.' }, 503)
  if (aiConfig.default === 'anthropic' && !aiConfig.drivers.anthropic.apiKey)
    return json({ error: 'ANTHROPIC_API_KEY is not configured on the server.' }, 503)

  const active = (await db.unsafe(
    `SELECT id FROM autofix_runs WHERE issue_id = $1
     AND status IN ('queued', 'analyzing', 'planning', 'editing', 'creating_pr')
     ORDER BY created_at DESC LIMIT 1`,
    [access.id],
  ))?.[0]
  if (active) return json({ error: 'An Autofix run is already active.', run_id: active.id }, 409)

  const runId = globalThis.crypto.randomUUID()
  try {
    await db.unsafe(
      `INSERT INTO autofix_runs (id, issue_id, project_id, created_by, status, provider)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [runId, access.id, access.project_id, Number(user.id), 'queued', aiConfig.default],
    )
  }
  catch (error) {
    if ((error as { code?: string })?.code === '23505')
      return json({ error: 'An Autofix run is already active.' }, 409)
    throw error
  }
  try {
    await RunAutofix.dispatch({ runId })
  }
  catch (error) {
    const message = error instanceof Error ? error.message : 'Could not dispatch Autofix.'
    await db.unsafe(
      'UPDATE autofix_runs SET status = $1, error = $2, completed_at = NOW(), updated_at = NOW() WHERE id = $3',
      ['failed', message.slice(0, 4000), runId],
    )
    return json({ error: 'Could not dispatch Autofix.' }, 503)
  }
  return json({ run: publicRun((await db.unsafe('SELECT * FROM autofix_runs WHERE id = $1 LIMIT 1', [runId]))?.[0]) }, 202)
}).skipCsrf()

route.put('/api/projects/{projectId}/repository', async (request: any) => {
  if (!sameOrigin(request)) return json({ error: 'origin mismatch' }, 403)
  const user = await currentUser(request)
  if (!user) return json({ error: 'unauthorized' }, 401)
  const project = await ownerProject(user, request.params.projectId)
  if (!project) return json({ error: 'not found' }, 404)

  const body = request.jsonBody ?? {}
  const repository = String(body.repository ?? '').trim()
  if (!repository) {
    await db.unsafe('UPDATE projects SET repository = NULL, repository_branch = NULL, updated_at = NOW() WHERE id = $1', [project.id])
    return json({ repository: null, repository_branch: null })
  }
  if (!process.env.GITHUB_TOKEN) return json({ error: 'GitHub access is not configured on the server.' }, 503)
  try {
    const target = parseRepository(repository)
    const canonical = `${target.owner}/${target.repo}`
    const info = await repositoryInfo(target)
    const branch = String(body.branch || info.defaultBranch).trim()
    if (!branch || branch.length > 255) return json({ error: 'Enter a valid branch.' }, 400)
    await repositoryTree(target, branch)
    await db.unsafe(
      'UPDATE projects SET repository = $1, repository_branch = $2, updated_at = NOW() WHERE id = $3',
      [canonical, branch, project.id],
    )
    return json({ repository: canonical, repository_branch: branch })
  }
  catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Could not connect the repository.' }, 400)
  }
}).skipCsrf()
