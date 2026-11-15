export const ISSUE_STATUSES = ['unresolved', 'resolved', 'ignored'] as const
export type IssueStatus = typeof ISSUE_STATUSES[number]

const SNOOZE_PRESETS = {
  '1h': 60 * 60 * 1000,
  '4h': 4 * 60 * 60 * 1000,
  '1d': 24 * 60 * 60 * 1000,
  '1w': 7 * 24 * 60 * 60 * 1000,
} as const

export function isIssueStatus(value: unknown): value is IssueStatus {
  return typeof value === 'string' && ISSUE_STATUSES.includes(value as IssueStatus)
}

export function statusAfterOccurrence(status: unknown): IssueStatus {
  return status === 'resolved' || !isIssueStatus(status) ? 'unresolved' : status
}

export function snoozedUntil(preset: unknown, now = Date.now()): string | null {
  if (typeof preset !== 'string' || !(preset in SNOOZE_PRESETS))
    return null
  return new Date(now + SNOOZE_PRESETS[preset as keyof typeof SNOOZE_PRESETS]).toISOString()
}

/** The most issue ids one bulk status change may name. */
export const MAX_BULK_TRIAGE = 200

/**
 * The ids a bulk request names: strings, de-duplicated, in the order given.
 * Null when the body is not a non-empty list of ids within the limit, so the
 * route answers 400 instead of updating part of a malformed request.
 */
export function bulkIssueIds(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_BULK_TRIAGE)
    return null
  const ids: string[] = []
  for (const entry of value) {
    if (typeof entry !== 'string' || !/^[\w-]{1,64}$/.test(entry))
      return null
    if (!ids.includes(entry))
      ids.push(entry)
  }
  return ids
}
