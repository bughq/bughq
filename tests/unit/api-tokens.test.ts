import { describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { bulkIssueIds, MAX_BULK_TRIAGE } from '../../app/Errors/triage'
import { GRANTABLE_SCOPES, isFullSession, scopesAllow, TOKEN_SCOPES } from '../../app/Support/access'
import { API_TOKEN_LIFETIME_DAYS, requestedScopes, tokenExpiry, tokenName } from '../../app/Support/api-tokens'

const ROOT = join(import.meta.dir, '../..')
const read = (path: string): string => readFileSync(join(ROOT, path), 'utf8')

/** Every source file under a directory the app serves from. */
function sources(dir: string): string[] {
  const found: string[] = []
  for (const entry of readdirSync(join(ROOT, dir))) {
    const path = join(dir, entry)
    if (statSync(join(ROOT, path)).isDirectory())
      found.push(...sources(path))
    else if (/\.(?:ts|stx)$/.test(entry))
      found.push(path)
  }
  return found
}

describe('scopes', () => {
  test('a sign-in is the only thing that is a full session', () => {
    expect(isFullSession(['*'])).toBe(true)
    expect(isFullSession([TOKEN_SCOPES.triage])).toBe(false)
    expect(isFullSession([TOKEN_SCOPES.read, TOKEN_SCOPES.triage])).toBe(false)
    expect(isFullSession([])).toBe(false)
  })

  test('a token is allowed what it names, and a session everything', () => {
    expect(scopesAllow([TOKEN_SCOPES.triage], TOKEN_SCOPES.triage)).toBe(true)
    expect(scopesAllow(['*'], TOKEN_SCOPES.triage)).toBe(true)
    // Reading does not come with closing issues, nor the other way round.
    expect(scopesAllow([TOKEN_SCOPES.read], TOKEN_SCOPES.triage)).toBe(false)
    expect(scopesAllow([TOKEN_SCOPES.triage], TOKEN_SCOPES.read)).toBe(false)
    expect(scopesAllow([], TOKEN_SCOPES.read)).toBe(false)
  })
})

describe('requestedScopes', () => {
  test('accepts the grantable scopes, without repeats', () => {
    expect(requestedScopes([TOKEN_SCOPES.triage])).toEqual([TOKEN_SCOPES.triage])
    expect(requestedScopes([TOKEN_SCOPES.read, TOKEN_SCOPES.triage, TOKEN_SCOPES.read])).toEqual([TOKEN_SCOPES.read, TOKEN_SCOPES.triage])
  })

  test('never grants a full session, or anything it does not know', () => {
    expect(GRANTABLE_SCOPES).not.toContain('*')
    for (const value of [['*'], [TOKEN_SCOPES.triage, '*'], ['projects:delete'], [], [1], 'issues:triage', null, undefined, {}])
      expect(requestedScopes(value)).toBeNull()
  })
})

describe('tokenName', () => {
  test('trims and collapses whitespace', () => {
    expect(tokenName('  release   pipeline ')).toBe('release pipeline')
  })

  test('refuses an empty, over-long or non-string name', () => {
    for (const value of ['', '   ', 'x'.repeat(61), null, undefined, 42])
      expect(tokenName(value)).toBeNull()
    expect(tokenName('x'.repeat(60))).toHaveLength(60)
  })
})

describe('tokenExpiry', () => {
  test('is a year out', () => {
    const now = new Date('2026-01-01T00:00:00.000Z')
    expect(tokenExpiry(now).getTime() - now.getTime()).toBe(API_TOKEN_LIFETIME_DAYS * 24 * 60 * 60 * 1000)
  })
})

describe('bulkIssueIds', () => {
  test('keeps the ids in order and drops repeats', () => {
    expect(bulkIssueIds(['b', 'a', 'b'])).toEqual(['b', 'a'])
  })

  test('refuses anything that is not a list of ids within the limit', () => {
    const tooMany = Array.from({ length: MAX_BULK_TRIAGE + 1 }, (_, index) => `id${index}`)
    for (const value of [undefined, null, 'abc', {}, [], [1], ['ok', null], ['has space'], ['a\'; DROP TABLE issues; --'], tooMany])
      expect(bulkIssueIds(value)).toBeNull()
  })

  test('accepts exactly the limit', () => {
    expect(bulkIssueIds(Array.from({ length: MAX_BULK_TRIAGE }, (_, index) => `id${index}`))).toHaveLength(MAX_BULK_TRIAGE)
  })
})

describe('a token becomes a person in one place', () => {
  /*
   * `Auth.getUserFromToken` and `Auth.validateToken` answer for any live token
   * whatever its scopes. Before API tokens existed that was the same thing as
   * "signed in"; now a token created to resolve issues is also a live token,
   * and any route or view that asked the framework directly would treat it as
   * its owner. So nothing asks directly: sessionUser / userWithScope in
   * app/Support/access.ts are the only callers, and this fails on a new one.
   */
  const ALLOWED = new Set([
    'app/Support/access.ts',
    // Reads back the user for the token it has just issued at sign-up.
    'app/Actions/Auth/RegisterAction.ts',
  ])

  test('nothing else resolves a token through the framework directly', () => {
    const offenders: string[] = []
    for (const file of [...sources('app'), ...sources('routes'), ...sources('resources')]) {
      if (ALLOWED.has(file))
        continue
      const code = read(file).split('\n').filter(line => !/^\s*(?:\/\/|\*|\/\*|\{\{--)/.test(line)).join('\n')
      if (/\bAuth\.(?:getUserFromToken|validateToken)\s*\(/.test(code))
        offenders.push(relative(ROOT, join(ROOT, file)))
    }
    expect(offenders).toEqual([])
  })

  test('the session helper refuses a token that is not a full session', () => {
    const access = read('app/Support/access.ts')
    const session = access.slice(access.indexOf('export async function sessionUser'), access.indexOf('export async function userWithScope'))
    expect(session).toContain('isFullSession(holder.scopes)')
  })

  test('the auth middleware asks for a session, not merely a valid token', () => {
    const middleware = read('app/Middleware/Auth.ts')
    expect(middleware).toContain('await sessionUser(bearerToken)')
    expect(middleware).toContain('await sessionUser(cookieToken)')
  })
})

describe('the token routes use the framework\'s tokens', () => {
  const routes = read('routes/tokens.ts')

  test('mint, list and revoke through @stacksjs/auth', () => {
    expect(routes).toContain('import { createToken, revokeTokenById, tokens } from \'@stacksjs/auth\'')
    // Nothing here generates or stores a credential of its own.
    expect(routes).not.toMatch(/getRandomValues|randomUUID|INSERT INTO|UPDATE /)
  })

  test('every route needs a full session', () => {
    const handlers = routes.split(/\nroute\./).slice(1)
    expect(handlers).toHaveLength(3)
    for (const handler of handlers)
      expect(handler).toContain('const user = await currentUser(request)')
  })

  test('revoking looks the id up in the caller\'s own tokens', () => {
    const revoke = routes.slice(routes.indexOf('route.delete(\'/api/account/tokens/{tokenId}\''))
    expect(revoke.indexOf('apiTokensOf(Number(user.id))')).toBeLessThan(revoke.indexOf('revokeTokenById('))
  })
})

describe('the triage routes', () => {
  const errors = read('routes/errors.ts')
  const body = errors.slice(errors.indexOf('async function changeIssueStatuses'))

  test('authorise before they validate or write', () => {
    expect(body.indexOf('projectTriageAccess(request, projectId)')).toBeGreaterThan(-1)
    expect(body.indexOf('projectTriageAccess(request, projectId)')).toBeLessThan(body.indexOf('UPDATE issues SET status'))
  })

  test('scope the write to the project in the path', () => {
    expect(body).toContain('WHERE project_id = $2 AND id IN (')
  })

  test('ask for the triage scope, and for access to the project', () => {
    const access = read('app/Support/access.ts')
    const triage = access.slice(access.indexOf('export async function projectTriageAccess'))
    expect(triage).toContain('userWithScope(bearerFrom(request), TOKEN_SCOPES.triage)')
    expect(triage).toContain('canAccessProject(user, projectId)')
  })
})
