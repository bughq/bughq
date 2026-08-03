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
  run?: AutofixRun | null
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
declare interface AuthHeaders {
  'Authorization': string
  'Content-Type': string
}

