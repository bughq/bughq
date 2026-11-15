/**
 * API tokens: the credentials a person creates so a pipeline or an agent can
 * act on their projects without their session.
 *
 *   GET    /api/account/tokens        the signed-in person's live tokens
 *   POST   /api/account/tokens        create one; the plaintext is returned once
 *   DELETE /api/account/tokens/{id}   revoke one
 *
 * These are Stacks personal access tokens, used as the framework provides
 * them: `createToken` mints one and stores only its hash, `tokens` lists
 * them, `revokeTokenById` ends one (@stacksjs/auth). This file decides who
 * may ask and what they may ask for (app/Support/api-tokens.ts), and nothing
 * here generates, stores or compares a credential.
 *
 * All three need a full session. A token cannot list, create or revoke
 * tokens, its own included: `currentUser` refuses anything that is not a
 * sign-in (app/Support/access.ts).
 */

import { createToken, revokeTokenById, tokens } from '@stacksjs/auth'
import { route } from '@stacksjs/router'
import { currentUser, isFullSession } from '../app/Support/access'
import { MAX_API_TOKENS, requestedScopes, tokenExpiry, tokenName } from '../app/Support/api-tokens'
import { sameOrigin } from '../app/Support/origin'

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
}

interface ListedToken {
  id: number
  name: string
  scopes: readonly string[]
  createdAt: Date
  expiresAt: Date | null
}

function view(token: ListedToken): { id: number, name: string, scopes: readonly string[], created_at: string, expires_at: string | null } {
  return {
    id: token.id,
    name: token.name,
    scopes: token.scopes,
    created_at: token.createdAt.toISOString(),
    expires_at: token.expiresAt ? token.expiresAt.toISOString() : null,
  }
}

/**
 * The account's API tokens: live, and not a sign-in.
 *
 * `tokens()` answers every unrevoked token the account holds, the browser
 * sessions among them. Those carry `*` and are not listed here, so this page
 * can never be used to revoke the session that is looking at it.
 */
async function apiTokensOf(userId: number): Promise<ListedToken[]> {
  const now = Date.now()
  return (await tokens(userId))
    .filter(token => !isFullSession(token.scopes))
    .filter(token => token.expiresAt == null || token.expiresAt.getTime() > now)
}

route.get('/api/account/tokens', async (request: any) => {
  const user = await currentUser(request)
  if (!user)
    return json({ error: 'unauthorized' }, 401)
  return json({ tokens: (await apiTokensOf(Number(user.id))).map(view) })
})

route.post('/api/account/tokens', async (request: any) => {
  if (!sameOrigin(request))
    return json({ error: 'forbidden' }, 403)
  const user = await currentUser(request)
  if (!user)
    return json({ error: 'unauthorized' }, 401)

  const name = tokenName(request.jsonBody?.name)
  if (!name)
    return json({ error: 'Give the token a name of up to 60 characters.' }, 422)
  const scopes = requestedScopes(request.jsonBody?.scopes)
  if (!scopes)
    return json({ error: 'Choose at least one thing the token may do.' }, 422)

  const userId = Number(user.id)
  if ((await apiTokensOf(userId)).length >= MAX_API_TOKENS)
    return json({ error: `An account can hold ${MAX_API_TOKENS} tokens. Revoke one first.` }, 409)

  // No refresh token: an API token is replaced by creating another, and a
  // refresh credential would be a second secret nobody asked for.
  const created = await createToken(userId, name, scopes, { expiresAt: tokenExpiry(), withRefreshToken: false })
  return json({ token: created.plainTextToken, ...view({ ...created.accessToken, name, scopes }) }, 201)
}).skipCsrf()

route.delete('/api/account/tokens/{tokenId}', async (request: any) => {
  if (!sameOrigin(request))
    return json({ error: 'forbidden' }, 403)
  const user = await currentUser(request)
  if (!user)
    return json({ error: 'unauthorized' }, 401)

  // Only a token this account holds, and only an API token: the id is looked
  // up in the account's own list rather than trusted, so one person cannot
  // revoke another's, and a session id is answered 404 like any stranger's.
  const tokenId = Number(request.params.tokenId)
  const owned = Number.isSafeInteger(tokenId)
    ? (await apiTokensOf(Number(user.id))).find(token => token.id === tokenId)
    : undefined
  if (!owned)
    return json({ error: 'not found' }, 404)

  await revokeTokenById(owned.id)
  return json({ revoked: true })
}).skipCsrf()
