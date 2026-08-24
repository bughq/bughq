/**
 * bughq domain shapes.
 *
 * These mirror the Postgres schema exactly — column names, nullability and all.
 * Reads go through `db.unsafe(...)`, which returns `any`, so nothing about a row
 * is checked at the boundary. Annotating the destination is what gives a `.stx`
 * script block any type information at all.
 *
 * Ambient on purpose: `types/**\/*.d.ts` is in the tsconfig `include`, so these
 * names are available in every server and client block without an import —
 * which matters because a value `import` in a `.stx` script is forbidden
 * (auto-imports), and an unnecessary `import type` is noise.
 *
 * Nullability is not decorative. `culprit`, `level`, `count` and friends really
 * are nullable in the database, and code that assumes otherwise is the bug these
 * types exist to surface.
 */

/** A row of `issues`. Grouped by `fingerprint`; one per distinct error. */
declare interface Issue {
  id: string
  project_id: string
  fingerprint: string
  title: string
  culprit: string | null
  error_type: string | null
  level: IssueLevel | null
  status: IssueStatus | null
  assignee: string | null
  count: number | null
  users_affected: number | null
  first_seen: string | null
  last_seen: string | null
  created_at: string
  updated_at: string | null
}

/** A row of `error_events`. Many per Issue; `metadata` and `user_context` are JSON text. */
declare interface ErrorEvent {
  id: string
  project_id: string
  issue_id: string | null
  message: string
  stack: string | null
  error_type: string | null
  category: string | null
  severity: string | null
  fingerprint: string | null
  url: string | null
  browser: string | null
  os: string | null
  user_agent: string | null
  framework: string | null
  release: string | null
  environment: string | null
  /** JSON text, not an object. Parse before use. */
  user_context: string | null
  /** JSON text, not an object. Parse before use. */
  metadata: string | null
  timestamp: string
  created_at: string
  updated_at: string | null
}

declare interface Project {
  id: string
  name: string
  platform: string | null
  dsn: string | null
  ingest_key: string | null
  owner_id: number | null
  /** `false` means archived: ingestion is rejected and alerts pause. */
  is_active: boolean | null
  created_at: string
  updated_at: string | null
}

declare interface ProjectMember {
  id: string
  project_id: string
  email: string
  role: string
  created_at: string
}

declare interface ProjectInvite {
  id: string
  project_id: string
  email: string
  token: string
  invited_by: number | null
  created_at: string
  /**
   * Whether the join link actually reached them. `pending` means no verdict
   * yet — the row is written before the transport answers, and the invite
   * endpoint stops waiting after a timeout.
   */
  delivery_status: 'pending' | 'sent' | 'failed'
  /** The provider's reason, when `delivery_status` is `failed`. */
  delivery_error: string | null
  delivered_at: string | null
}

declare interface AlertChannel {
  id: string
  project_id: string
  type: AlertChannelType
  label: string | null
  webhook_url: string
  enabled: boolean | null
  created_at: string
  updated_at: string | null
}

declare type IssueLevel = 'fatal' | 'error' | 'warning' | 'info' | 'debug'
declare type IssueStatus = 'unresolved' | 'resolved' | 'ignored'
declare type AlertChannelType = 'slack' | 'discord'

/** One parsed frame of a stack trace, as rendered on the issue page. */
declare interface StackFrame {
  func: string
  base: string
  dir: string
  line: string | null
  col: string | null
  /** False for node_modules / vendor / runtime-internal frames, which collapse. */
  isApp: boolean
}

/** A `Caused by:` section of a stack trace, or the top-level exception. */
declare interface StackGroup {
  header: string
  isCause: boolean
  frames: StackFrame[]
}

/** A breadcrumb from an event's `metadata` bundle. */
declare interface Breadcrumb {
  category?: string
  type?: string
  level?: string
  message?: string
  timestamp?: string | number
  data?: Record<string, unknown>
}

/** How a breadcrumb is classified for its icon and tint on the issue page. */
declare type BreadcrumbKind = 'http' | 'nav' | 'ui' | 'console' | 'query' | 'error' | 'default'

// --- autofix ---------------------------------------------------------------

declare type AutofixStatus =
  | 'queued' | 'analyzing' | 'planning' | 'editing' | 'creating_pr'
  | 'completed' | 'failed'

/** A row of `autofix_runs` (migration 0000000024). */
/**
 * The parsed `plan` an autofix run stores. Written by app/Autofix/workflow.ts as
 * `json({ confidence, steps, tests, requestedFiles })`.
 */
declare interface AutofixPlan {
  confidence?: 'low' | 'medium' | 'high'
  steps?: Array<{ title: string, detail: string }>
  tests?: string[]
  requestedFiles?: string[]
}

/** The parsed `changes` an autofix run stores — the proposed fix. */
declare interface AutofixChanges {
  summary?: string
  prTitle?: string
  prBody?: string
  files?: Array<{ path: string, content: string, explanation?: string }>
  tests?: string[]
  risks?: string[]
}

/**
 * An autofix run as the API sends it, which is NOT the row shape below.
 *
 * `plan` and `changes` are `text` in Postgres and stay strings on AutofixRun,
 * but routes/autofix.ts runs both through parseStored() before answering, so a
 * client receives objects. AutofixPanel reads `plan.steps` and `changes.files`
 * and is right to — it was the row type being applied to a wire value that made
 * that look like a mistake.
 */
declare interface AutofixRunView extends Omit<AutofixRun, 'plan' | 'changes'> {
  plan: AutofixPlan | null
  changes: AutofixChanges | null
}

/** A row of `autofix_runs`, exactly as stored. See AutofixRunView for the wire shape. */
declare interface AutofixRun {
  id: string
  issue_id: string
  project_id: string
  created_by: number | null
  status: AutofixStatus
  provider: string | null
  model: string | null
  root_cause: string | null
  plan: string | null
  changes: string | null
  branch_name: string | null
  pr_url: string | null
  pr_number: number | null
  error: string | null
  started_at: string | null
  completed_at: string | null
  created_at: string
  updated_at: string | null
}

/** What GET /api/…/autofix returns and the panel holds in a signal. */
declare interface AutofixState {
  /**
   * The wire shape, not the row: plan and changes arrive parsed.
   *
   * Partial because the panel optimistically holds `{ status: 'queued' }` the
   * moment you press Run, before the server has a run to describe. That stub is
   * a real state the UI renders, so the type admits it rather than being
   * asserted away at the one call site that creates it.
   */
  run?: Partial<AutofixRunView> | null
  repository?: string | null
  branch?: string | null
  [key: string]: unknown
}

// --- view models -----------------------------------------------------------

/** The dashboard's URL state. Every field optional: pageUrl takes a partial override. */
declare interface DashboardQuery {
  status?: string
  range?: string
  page?: number
}

/** The status tabs. Anything else in `?status=` falls back to 'unresolved'. */
declare type DashboardStatus = 'unresolved' | 'resolved' | 'ignored' | 'all'

/**
 * One entry in the dashboard's RANGES whitelist. `interval` is the Postgres
 * interval string and is the ONLY part ever interpolated into SQL — `key` comes
 * from the URL and never reaches a query. `null` means all time, i.e. no date
 * predicate at all, which is why it is nullable rather than an empty string.
 */
declare interface DashboardRange {
  key: string
  label: string
  interval: string | null
}

/**
 * A project as the dashboard and /projects select it: the columns those pages
 * read, plus `is_owner`, which is computed per-viewer (`p.owner_id = $1`) and
 * therefore is not a column on Project.
 */
declare interface DashboardProject {
  id: string
  name: string
  platform: string | null
  ingest_key: string | null
  created_at: string | null
  is_active: boolean | null
  is_owner?: boolean
}

/**
 * A pending invitation as the dashboard's banner selects it: the join token and
 * the name of the project it is for, which is everything one banner row prints.
 * `token` doubles as the row's identity — it is what the dismiss list holds and
 * what the accept call sends.
 */
declare interface DashboardInvite {
  token: string
  project_name: string
}

/**
 * An issue row as the dashboard renders it: the columns selected from `issues`,
 * plus the per-issue facets folded on from `error_events` afterwards.
 *
 * `users_affected` is deliberately NOT the `issues.users_affected` column —
 * ingest writes that as a literal 0 and never updates it. Both this page and
 * the issue detail page compute it live from the events' distinct users.
 */
declare interface DashboardIssue {
  id: string
  title: string
  culprit: string | null
  error_type: string | null
  level: IssueLevel | null
  status: IssueStatus | null
  count: number | null
  last_seen: string | null
  users_affected: number
  release: string | null
  environment: string | null
  environmentCount: number
  newInRelease: boolean
}

/** What installGuide() returns for a project's platform. */
declare interface InstallGuide {
  label: string
  install: string
  code: string
}

/** A note rendered under a form — settings uses this shape throughout. */
declare interface FormNote {
  text: string
  ok: boolean
}

/** Auth headers for a bearer-token fetch. */
/**
 * A `type`, not an `interface`, and that is load-bearing. These headers are
 * handed straight to `fetch`, whose HeadersInit wants a Record<string, string>.
 * An interface has no implicit index signature so it does not satisfy that, and
 * every `fetch(url, { headers: authHeaders() })` call failed to match an
 * overload. A type alias does get the index signature.
 */
declare type AuthHeaders = {
  'Authorization': string
  'Content-Type': string
}


/* ---------------------------------------------------------------------------
 * Ambient globals live in this same file, not a sibling, because `stx typecheck
 * --lib` does NOT accumulate: `--lib a --lib b` behaves exactly like `--lib b`
 * alone, verified by measurement, even though `--help` calls the flag
 * repeatable. Splitting these across two files silently drops whichever is not
 * last. Filed as stacksjs/stx#1926 and FIXED upstream by 65c070cf30, which is
 * not in a release yet — 0.2.176 is the newest tag and still drops all but the
 * last (re-measured on the clean install: two --lib flags gave 167 errors where
 * one gives 0). Split these back into their own file on the release that
 * carries that commit.
 * ------------------------------------------------------------------------- */

/**
 * Ambient globals that a `.stx` script block can reach without an import.
 *
 * `requestContext` is the SSR request accessor, injected by the renderer. Every
 * page that authenticates reads a cookie through it, which made it the single
 * largest source of type errors here once the checker started working: 78 of
 * the first 407.
 *
 * This MIRRORS `StacksRequestContext` in @stacksjs/config
 * (dist/request-context.d.ts) field for field — that module is what
 * stacksjs/stacks#2232 produced, and both servers install exactly its object,
 * so this is a copy of the real shape rather than a guess at it. Copied only
 * because a `.stx` script block cannot import a type; delete it the day one
 * can.
 *
 * The first version of this block WAS a guess and got two things wrong: `url`
 * declared as a string when it is an accessor, and a `header()` that the
 * installed object does not have at all. Three files grew `unknown` +
 * typeof-callable workarounds around the first of those before anyone read the
 * framework's own declaration. If this drifts again, diff it against that file
 * rather than inferring from call sites.
 *
 * Still `| undefined`, which is not pedantry: the global is genuinely absent in
 * the SSG build and in the client bundle, so every call site guards with
 * `typeof requestContext !== 'undefined' && …` and the type must keep them
 * honest.
 */
declare const requestContext: {
  /** Read a request cookie by name. `null` when absent. */
  cookie: (name: string) => string | null
  cookies: () => Record<string, string>
  /** The full request URL. An ACCESSOR, not a string. */
  url: () => string
  path: () => string
  search: () => string
  query: () => Record<string, string>
  params: () => Record<string, string>
  locale: () => string
  ip: () => string
  host: () => string
} | undefined

/**
 * The query string the serve path hands a page, set by the renderer before the
 * server block runs. Read via `new URLSearchParams(globalThis.__stxServeSearch)`
 * in dashboard.stx and settings.stx.
 */
declare namespace globalThis {
  // eslint-disable-next-line vars-on-top, no-var
  var __stxServeSearch: string | undefined
}
