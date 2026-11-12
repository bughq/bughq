/**
 * New project ids and ingest keys. Shared by the create-app endpoint
 * (routes/projects.ts) and the CLI connect flow (app/Hq/adapter.ts), so a
 * project made either way is indistinguishable.
 */

/** A short, readable, unique project id: slug of the name + a random suffix. */
export function newProjectId(name: string): string {
  const slug = (name || 'app')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24) || 'app'
  const rand = globalThis.crypto.randomUUID().replace(/-/g, '').slice(0, 6)
  return `${slug}-${rand}`
}

/**
 * A public, revocable ingest key (not a secret; ships in client code). The
 * `bughq_` prefix makes it recognizable as a bughq key at a glance (Stripe/
 * GitHub style) and greppable in code and logs.
 */
export function newIngestKey(): string {
  return `bughq_${(globalThis.crypto.randomUUID() + globalThis.crypto.randomUUID()).replace(/-/g, '')}`
}
