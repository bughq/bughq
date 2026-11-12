import type { HqService } from '@stacksjs/hq/service'
import type { HqUser } from './adapter'
import { db } from '@stacksjs/database'
import { createHqService } from '@stacksjs/hq/service'
import { isPro } from '../Billing/pro'
import { counter, usageDialect } from '../Billing/usage'
import { appUrl } from '../Support/urls'
import { createBughqAdapter } from './adapter'

/**
 * The connect and usage service, over this app's real database.
 *
 * Imported by the API routes (routes/hq.ts) and by the approve page
 * (resources/views/cli/connect.stx). Those run in two processes, and that is
 * fine: a code lives in `hq_connect_codes`, not in memory, so a code issued by
 * the API process is one the page can describe.
 */
export const hq: HqService<HqUser> = createHqService(createBughqAdapter({
  sql: db,
  dialect: usageDialect(),
  counter,
  isPro,
  appUrl,
}))
