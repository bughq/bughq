/**
 * The account you sign in with locally, and the production owner bootstrap.
 *
 *   ./buddy seed --only-seeders OwnerSeeder --skip-models
 *
 * ## Why this file has to exist
 *
 * Model-factory seeding will not produce a usable sign-in, in two separate
 * ways. `User` is on @stacksjs/database's ACCOUNT_MODELS list, so the factory
 * pass leaves foreign keys that point at a user null rather than inventing an
 * owner; the framework's note on that list says which account owns a seeded
 * row is "a decision for the app that seeded it (a `demo:account` command, a
 * fixture, a migration), not something a factory should guess". And the
 * `useSeeder` trait on `User` writes rows whose emails come from
 * `faker.internet.email()` -- accounts nobody can sign in to, because the
 * addresses are unknowable. This file is that decision for BugHQ.
 *
 * ## What this app needs that the others do not
 *
 * BugHQ has no teams: no `teams` table, no Team model. Tenancy is a project
 * with an `owner_id`, so the seeder makes a user and one project owned by it,
 * which is what the dashboard needs to render something other than an empty
 * state. `project_members` and `project_invites` are left alone on purpose --
 * they key members by email and exist for invitations, while an owner is
 * established by `projects.owner_id`, exactly as routes/projects.ts does it
 * when a project is created through the UI.
 *
 * ### The duplicated id and key helpers
 *
 * `projectId` and `ingestKey` below are copies of `newProjectId` and
 * `newIngestKey` in routes/projects.ts, which is the authority for both
 * formats -- the `bughq_` prefix on a key is relied on for recognising one at
 * a glance and grepping for it. They are copied rather than imported because
 * they are module-local functions in a routes file, and importing that file
 * to reach them would register every route in it as a side effect of seeding.
 * If either format changes there, change it here: a key minted in a different
 * shape is accepted by this seeder and then rejected by ingest, which only
 * shows up once an SDK is pointed at it.
 *
 * ## Credentials
 *
 * `BUGHQ_OWNER_EMAIL` / `BUGHQ_OWNER_PASSWORD` when set. A local environment
 * falls back to the constants below so that a fresh clone can sign in after
 * one `./buddy seed` with nothing to configure; every other environment must
 * supply the password, and production refuses to run without both. The
 * fallback is keyed on an explicit allowlist of APP_ENV values rather than
 * "not production", so a staging deploy that forgets to set them gets the
 * skip and not a published default password.
 */
import { db, Seeder } from '@stacksjs/database'
import { env } from '@stacksjs/env'
import { log } from '@stacksjs/logging'
import { makeHash, verifyHash } from '@stacksjs/security'

/**
 * The local fallback. `.localhost` is reserved by RFC 6761 and resolves
 * nowhere but this machine, so the address cannot be mistaken for a real
 * mailbox or receive a stray notification.
 */
const DEV_EMAIL = 'owner@bughq.localhost'
const DEV_PASSWORD = 'stacks-dev-only'
const DEV_NAME = 'BugHQ Owner'
const PROJECT_NAME = 'BugHQ'

/** APP_ENV values that may use the fallback credentials above. */
const LOCAL_ENVS = new Set(['development', 'local', 'test', 'testing'])
const PRODUCTION_ENVS = new Set(['prod', 'production'])

/** A short, readable, unique project id: slug of the name + a random suffix. */
function projectId(name: string): string {
  const slug = (name || 'app')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24) || 'app'
  const rand = globalThis.crypto.randomUUID().replace(/-/g, '').slice(0, 6)
  return `${slug}-${rand}`
}

/** A public, revocable ingest key. The `bughq_` prefix is load-bearing. */
function ingestKey(): string {
  return `bughq_${(globalThis.crypto.randomUUID() + globalThis.crypto.randomUUID()).replace(/-/g, '')}`
}

/**
 * The id of the one user with this address, or undefined.
 *
 * Number(): `users.id` is a bigint and Postgres hands a bigint back as a
 * string. A string flowing into `projects.owner_id` is a foreign key the
 * dialect then rejects. This app reads Postgres, so that is the live path
 * and not a hypothetical -- `projects.id`, by contrast, really is a varchar
 * and is looked up separately below rather than through here.
 */
async function findUserId(email: string): Promise<number | undefined> {
  const row = await db.selectFrom('users' as any)
    .select(['id'] as any)
    .where('email' as any, '=', email)
    .executeTakeFirst() as { id?: number | string } | undefined

  return row?.id === undefined ? undefined : Number(row.id)
}

/**
 * Whether `password` is the one behind `stored`.
 *
 * verifyHash THROWS rather than returning false when `stored` is not a hash
 * it can parse -- `Password verification failed with error "InvalidEncoding"`
 * -- and a row whose password column holds something unparseable is precisely
 * the case the caller is trying to repair.
 */
async function passwordMatches(password: string, stored: unknown): Promise<boolean> {
  if (typeof stored !== 'string' || stored.length === 0)
    return false

  try {
    return await verifyHash(password, stored)
  }
  catch {
    return false
  }
}

export default class OwnerSeeder extends Seeder {
  static override tags = ['owner'] as const

  async run(): Promise<void> {
    const appEnv = String(env.APP_ENV || '').toLowerCase()
    const isLocal = LOCAL_ENVS.has(appEnv)
    const isProduction = PRODUCTION_ENVS.has(appEnv)

    const envEmail = String(env.BUGHQ_OWNER_EMAIL || '').trim().toLowerCase()
    const envPassword = String(env.BUGHQ_OWNER_PASSWORD || '')

    if (isProduction && (!envEmail || !envPassword))
      throw new Error('BUGHQ_OWNER_EMAIL and BUGHQ_OWNER_PASSWORD are both required for the production owner bootstrap.')

    if (!envPassword && !isLocal) {
      log.info(`[OwnerSeeder] Skipped: BUGHQ_OWNER_PASSWORD is not set and APP_ENV="${appEnv}" is not a local environment.`)
      return
    }

    const email = envEmail || DEV_EMAIL
    const password = envPassword || DEV_PASSWORD
    const usedFallback = !envPassword
    const now = new Date().toISOString()

    let userId = await findUserId(email)
    if (!userId) {
      await db.insertInto('users' as any).values({
        name: DEV_NAME,
        email,
        password: await makeHash(password, { algorithm: 'bcrypt' }),
        // NOT NULL on this app's users table. This schema has no uuid, no
        // avatar and no is_super_admin column.
        two_factor_enabled: false,
        // Pre-verified: the local mailbox does not exist, so a seeded account
        // that had to click a link in an email could never finish signing in.
        email_verified_at: now,
        created_at: now,
        updated_at: now,
      } as any).execute()
      userId = await findUserId(email)
    }
    else if (isLocal) {
      /*
       * Keep the documented local password working. Re-running the seeder
       * after changing DEV_PASSWORD, or after an earlier experiment wrote
       * this row with a different hash, would otherwise leave a row that
       * exists and cannot be signed in to -- the exact failure this file is
       * here to end. Checked before writing so a run that changes nothing
       * issues no UPDATE, and confined to local environments so a deploy
       * never silently rotates a real account's password.
       */
      const row = await db.selectFrom('users' as any)
        .select(['password'] as any)
        .where('email' as any, '=', email)
        .executeTakeFirst() as { password?: string } | undefined

      if (!await passwordMatches(password, row?.password)) {
        await db.updateTable('users' as any)
          .set({ password: await makeHash(password, { algorithm: 'bcrypt' }), updated_at: now } as any)
          .where('email' as any, '=', email)
          .execute()
        log.info('[OwnerSeeder] Reset the local owner password to match this seeder.')
      }
    }

    if (!userId)
      throw new Error('The BugHQ owner account could not be resolved after creation.')

    /*
     * One project per owner per name, which is the rule routes/projects.ts
     * enforces on create. Matched on owner_id as well as name so the seeder
     * cannot adopt another account's project of the same name.
     */
    const project = await db.selectFrom('projects' as any)
      .select(['id'] as any)
      .where('owner_id' as any, '=', userId)
      .where('name' as any, '=', PROJECT_NAME)
      .executeTakeFirst() as { id?: string } | undefined

    if (!project) {
      await db.insertInto('projects' as any).values({
        // varchar, not an autoincrement integer: this app mints its own.
        id: projectId(PROJECT_NAME),
        name: PROJECT_NAME,
        platform: 'javascript',
        ingest_key: ingestKey(),
        owner_id: userId,
        is_active: true,
        created_at: now,
        updated_at: now,
      } as any).execute()
    }

    log.info(`[OwnerSeeder] Owner project is ready for ${email}.`)
    if (usedFallback)
      log.info(`[OwnerSeeder] Local fallback credentials in use: ${email} / ${DEV_PASSWORD}`)
  }
}

if (import.meta.main)
  await new OwnerSeeder().run()
