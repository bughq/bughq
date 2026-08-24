import { defineModel } from '@stacksjs/orm'
import { schema } from '@stacksjs/validation'

/**
 * An Issue groups ErrorEvents sharing a fingerprint — the unit of triage.
 * Occurrence counters roll up as events arrive; status/assignee track work.
 */
export default defineModel({
  name: 'Issue',
  table: 'issues',
  primaryKey: 'id',

  // No `useApi`: the auto-generated CRUD is not owner-scoped and would expose
  // every tenant's issues at /api/issues. Issue access is owner-scoped through
  // the routes in routes/errors.ts.
  traits: {
    useTimestamps: true,
  },

  belongsTo: ['Project'],
  hasMany: ['ErrorEvent'],

  indexes: [
    { name: 'issues_project_fingerprint', columns: ['project_id', 'fingerprint'], unique: true },
    { name: 'issues_project_lastseen', columns: ['project_id', 'last_seen'] },
  ],

  attributes: {
    id: { fillable: true, validation: { rule: schema.string().required() } },
    project_id: { fillable: true, validation: { rule: schema.string().required() } },
    fingerprint: { fillable: true, validation: { rule: schema.string().required() } },
    // max() here is not only validation — the migration generator maps it to a
    // column type, and the cutoff sits between 512 (emits varchar) and 1024
    // (emits text). At 500 it demanded `varchar(500)` while the table has always
    // been `text` (0000000002), so every `buddy migrate` saw a narrowing, flagged
    // "possible data loss", and REFUSED THE WHOLE RUN — which is why production
    // applied no migration between 11 Aug and this commit, and why its users
    // table never got the two_factor_* columns the login path reads.
    //
    // text is the correct type, not a lazy one: issueTitle() composes
    // `${errorType}: ${message.slice(0,240)}` (app/Errors/fingerprint.ts:51-55)
    // and errorType is NOT capped before that call, so a long error type yields a
    // title well past 500. Under varchar(500) that insert fails and the event is
    // lost. Same reasoning as ErrorEvent.message/stack, which use this exact
    // device to stay text.
    title: { fillable: true, validation: { rule: schema.string().required().max(65535) } },
    culprit: { fillable: true, validation: { rule: schema.string().optional() } },
    error_type: { fillable: true, validation: { rule: schema.string().optional() } },
    level: { fillable: true, validation: { rule: schema.string().optional() }, factory: () => 'error' },
    status: { fillable: true, validation: { rule: schema.string().optional() }, factory: () => 'unresolved' },
    assignee: { fillable: true, validation: { rule: schema.string().optional() } },
    count: { fillable: true, validation: { rule: schema.number().optional() }, factory: () => 0 },
    users_affected: { fillable: true, validation: { rule: schema.number().optional() }, factory: () => 0 },
    first_seen: { fillable: true, validation: { rule: schema.string().optional() } },
    last_seen: { fillable: true, validation: { rule: schema.string().optional() } },
  },
})
