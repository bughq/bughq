/**
 * Route Registry
 *
 * The key selects the route file; `prefix: ''` mounts it at the root. bughq's
 * ingest + issue APIs (`routes/errors.ts`) and auth endpoints (`routes/auth.ts`)
 * use absolute paths, so they mount at the root. `api`/`v1` keep the framework
 * defaults.
 *
 * @see https://docs.stacksjs.org/routing
 */
import type { RouteRegistry } from '@stacksjs/router'

export type { RouteDefinition, RouteRegistry } from '@stacksjs/router'

export default {
  api: 'api',
  v1: { path: 'v1', prefix: 'v1' },
  errors: { path: 'errors', prefix: '' },
  autofix: { path: 'autofix', prefix: '' },
  auth: { path: 'auth', prefix: '' },
  // The HQ connect and usage endpoints (`buddy hq:connect`, `buddy hq:status`).
  hq: { path: 'hq', prefix: '' },
} satisfies RouteRegistry
