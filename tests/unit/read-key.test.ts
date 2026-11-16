import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { isProjectToken, PROJECT_SCOPES, PROJECT_TOKEN_LIFETIME_DAYS, PROJECT_TOKEN_OWNER, projectTokenExpiry } from '../../app/Support/project-tokens'
import { connectReadKeyName, SETTINGS_READ_KEY_NAME } from '../../app/Support/read-key'

const ROOT = join(import.meta.dir, '../..')
const read = (path: string): string => readFileSync(join(ROOT, path), 'utf8')

/** A token as the framework answers it, owned by a project's principal. */
const projectToken = (scopes: string[]) => ({ id: 7, subjectType: PROJECT_TOKEN_OWNER, subjectId: 3, scopes })

describe('isProjectToken', () => {
  test('a read key is a principal-owned token carrying the read scope', () => {
    expect(isProjectToken(projectToken([PROJECT_SCOPES.read]), PROJECT_SCOPES.read)).toBe(true)
  })

  test('a read key cannot upload, and an upload token cannot read', () => {
    expect(isProjectToken(projectToken([PROJECT_SCOPES.read]), PROJECT_SCOPES.upload)).toBe(false)
    expect(isProjectToken(projectToken([PROJECT_SCOPES.upload]), PROJECT_SCOPES.read)).toBe(false)
  })

  test('a person\'s token is never a project token, whatever it carries', () => {
    // A sign-in, and an API token that happens to name the same scope.
    expect(isProjectToken({ id: 1, subjectType: 'users', subjectId: 3, scopes: ['*'] }, PROJECT_SCOPES.read)).toBe(false)
    expect(isProjectToken({ id: 1, subjectType: 'users', subjectId: 3, scopes: [PROJECT_SCOPES.read] }, PROJECT_SCOPES.read)).toBe(false)
    expect(isProjectToken({ id: 1, subjectId: 3, scopes: [PROJECT_SCOPES.read] }, PROJECT_SCOPES.read)).toBe(false)
  })

  test('full access is not a project scope', () => {
    expect(isProjectToken(projectToken(['*']), PROJECT_SCOPES.read)).toBe(false)
    expect(isProjectToken(projectToken(['*', PROJECT_SCOPES.read]), PROJECT_SCOPES.read)).toBe(false)
  })

  test('nothing, and a token with no owner id, are refused', () => {
    expect(isProjectToken(null, PROJECT_SCOPES.read)).toBe(false)
    expect(isProjectToken(undefined, PROJECT_SCOPES.read)).toBe(false)
    expect(isProjectToken({ id: 1, subjectType: PROJECT_TOKEN_OWNER, scopes: [PROJECT_SCOPES.read] }, PROJECT_SCOPES.read)).toBe(false)
  })
})

describe('a project token\'s life', () => {
  test('is the longest used here, because it runs unattended', () => {
    const now = new Date('2026-01-01T00:00:00.000Z')
    expect(projectTokenExpiry(now).getTime() - now.getTime()).toBe(PROJECT_TOKEN_LIFETIME_DAYS * 24 * 60 * 60 * 1000)
  })
})

describe('read key names', () => {
  test('a key given to a connected app is named after it', () => {
    expect(connectReadKeyName('cursio')).toBe('Connected: cursio')
    expect(connectReadKeyName('  my   app ')).toBe('Connected: my app')
    expect(connectReadKeyName('')).toBe('Connected app')
    expect(connectReadKeyName('x'.repeat(500)).length).toBeLessThanOrEqual('Connected: '.length + 100)
  })

  test('a key issued from settings has a fixed name', () => {
    expect(SETTINGS_READ_KEY_NAME).toBe('Read key')
  })
})

/*
 * Project tokens are the framework's tokens, owned by the project. The app
 * mints, lists, resolves and revokes them through @stacksjs/auth and keeps no
 * credential of its own.
 */
describe('project tokens are the framework\'s', () => {
  const support = read('app/Support/project-tokens.ts')

  test('minted, listed, resolved and revoked through @stacksjs/auth', () => {
    expect(support).toContain('import { createToken, findToken, revokeTokenById, tokens } from \'@stacksjs/auth\'')
    expect(support).toContain('tokenableType: PROJECT_TOKEN_OWNER')
    expect(support).not.toMatch(/getRandomValues|createHash|randomUUID/)
  })

  test('the app keeps no key column, generator or comparison', () => {
    for (const file of ['app/Support/read-key.ts', 'app/Errors/uploadTokens.ts', 'app/Hq/adapter.ts', 'app/Hq/service.ts', 'app/Support/access.ts']) {
      const source = read(file)
      expect({ file, clean: !/getRandomValues|createHash|sameKey\(|read_key\b/.test(source) }).toEqual({ file, clean: true })
    }
    expect(read('app/Models/Project.ts')).not.toContain('read_key')
  })

  test('a read is authorised against the project in the path', () => {
    const access = read('app/Support/access.ts')
    const readAccess = access.slice(access.indexOf('export async function projectReadAccess'), access.indexOf('export type ProjectTriageAccess'))
    expect(readAccess).toContain('projectForToken(presented, PROJECT_SCOPES.read)')
    // Another project's key answers 404, an archived project's 403.
    expect(readAccess).toContain('key.projectId !== String(projectId)')
    expect(readAccess).toContain('!key.isActive')
  })

  test('a read key does not open the triage endpoints', () => {
    const access = read('app/Support/access.ts')
    const triage = access.slice(access.indexOf('export async function projectTriageAccess'), access.indexOf('export async function uploadTarget'))
    expect(triage).not.toContain('projectForToken')
  })

  test('revoking looks a token up among the project\'s own', () => {
    const revoke = support.slice(support.indexOf('export async function revokeProjectToken'), support.indexOf('export async function revokeProjectTokens'))
    expect(revoke.indexOf('projectTokens(projectId, scope)')).toBeLessThan(revoke.indexOf('revokeTokenById('))
  })

  test('deleting a project revokes its tokens first', () => {
    const projects = read('routes/projects.ts')
    const handler = projects.slice(projects.indexOf('route.delete(\'/api/projects/{projectId}\', async'))
    expect(handler.indexOf('revokeProjectTokens(projectId, PROJECT_SCOPES.read)')).toBeLessThan(handler.indexOf('DELETE FROM projects WHERE id'))
    expect(handler.indexOf('revokeProjectTokens(projectId, PROJECT_SCOPES.upload)')).toBeLessThan(handler.indexOf('DELETE FROM projects WHERE id'))
  })
})
