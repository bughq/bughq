import type { TokenScope } from './access'
import { GRANTABLE_SCOPES } from './access'

/**
 * The app's side of an API token: what somebody may name one, which scopes
 * they may ask for, how long it lasts and how many they may hold.
 *
 * Everything else about a token is the framework's. It is a Stacks personal
 * access token: `createToken` mints it and stores only a hash, `tokens` lists
 * it, `findToken` resolves it and `revokeTokenById` ends it (@stacksjs/auth).
 * Nothing in this app stores, compares or generates a credential.
 */

/** A token lasts a year, then has to be created again. */
export const API_TOKEN_LIFETIME_DAYS = 365

/** How many live tokens one account may hold. */
export const MAX_API_TOKENS = 20

const MAX_NAME_LENGTH = 60

/**
 * The name a token is listed under, or null when there is not a usable one.
 *
 * A name is what somebody recognises a token by before revoking it, so an
 * empty one is refused rather than defaulted: twenty tokens called "token"
 * cannot be told apart.
 */
export function tokenName(value: unknown): string | null {
  if (typeof value !== 'string')
    return null
  const name = value.replace(/\s+/g, ' ').trim()
  return name.length > 0 && name.length <= MAX_NAME_LENGTH ? name : null
}

/**
 * The scopes a request asks for: each one grantable, at least one, none
 * repeated. Null otherwise.
 *
 * `*` is never grantable. It is what a sign-in carries, and a token holding
 * it would be a session that does not expire with the browser.
 */
export function requestedScopes(value: unknown): TokenScope[] | null {
  if (!Array.isArray(value) || value.length === 0)
    return null
  const scopes: TokenScope[] = []
  for (const entry of value) {
    const scope = GRANTABLE_SCOPES.find(candidate => candidate === entry)
    if (!scope)
      return null
    if (!scopes.includes(scope))
      scopes.push(scope)
  }
  return scopes
}

/** When a token created at `now` stops working. */
export function tokenExpiry(now: Date = new Date()): Date {
  return new Date(now.getTime() + API_TOKEN_LIFETIME_DAYS * 24 * 60 * 60 * 1000)
}
