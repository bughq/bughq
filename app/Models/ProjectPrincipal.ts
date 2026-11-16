import { defineModel } from '@stacksjs/orm'
import { schema } from '@stacksjs/validation'

/**
 * A project's machine identity: the owner of the tokens that act for the
 * project rather than for a person.
 *
 * Stacks personal access tokens are polymorphic. Each records its owner's
 * table and that owner's numeric id (`tokenable_type`, `tokenable_id`), so any
 * model can hold tokens, not only `User`. A project's id here is text
 * (`fettler-1a2b3c`), which that pair cannot carry, so a project is given one
 * row in this table and the row's id is what its tokens belong to.
 *
 * That is all this is: a numeric handle for a project, one to one. A read key
 * and an upload token are tokens owned by it (app/Support/project-tokens.ts).
 * Because no person owns them, they are unaffected by anybody's password
 * change or by the project changing hands, and the framework will not resolve
 * one to a user, so it can never be a session.
 *
 * No `useApi` and no fillable fields: rows are created on demand by
 * `principalId`, never by a request.
 */
export default defineModel({
  name: 'ProjectPrincipal',
  table: 'project_principals',

  traits: {
    useTimestamps: true,
  },

  belongsTo: ['Project'],

  indexes: [
    { name: 'project_principals_project_unique', columns: ['project_id'], unique: true },
  ],

  attributes: {
    project_id: { fillable: false, validation: { rule: schema.string().required().max(255) } },
  },
})
