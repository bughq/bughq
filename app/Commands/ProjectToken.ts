import { chmodSync, writeFileSync } from 'node:fs'
import process from 'node:process'
import { defineCommand, log } from '@stacksjs/cli'
import { db } from '@stacksjs/database'
import { ExitCode } from '@stacksjs/types'
import { uploadTokenName } from '../Errors/uploadTokens'
import { mintProjectToken, PROJECT_SCOPES } from '../Support/project-tokens'

/**
 * Mint a project token from the server's shell.
 *
 * Settings mints the same tokens in a browser, which is no use to a release
 * pipeline being set up by a script: a build that needs BUGHQ_UPLOAD_TOKEN had
 * to wait for someone to click one out. This is that button as a command.
 *
 * `--out` writes the token to a file only its owner can read and prints
 * nothing of it, so it can be moved into a secret store without ever being on
 * a screen or in a shell history. Without `--out` it is printed once.
 */
export default defineCommand({
  name: 'project:token <project>',
  description: 'Mint an upload token or read key for a project (by id)',
  options: {
    '--scope <scope>': { description: 'upload (debug files) or read (issues)', default: 'upload' },
    '--name <name>': { description: 'Label shown in the project settings', default: 'CI' },
    '--out <file>': 'Write the token to this file (mode 0600) instead of printing it',
  },
  async handle(options, project) {
    const scope = options.scope === 'read' ? PROJECT_SCOPES.read : options.scope === 'upload' ? PROJECT_SCOPES.upload : null
    if (!scope) {
      log.error('--scope is upload or read')
      process.exit(ExitCode.FatalError)
    }
    const found = await db.selectFrom('projects').select(['id', 'name']).where('id', '=', String(project)).executeTakeFirst()
    if (!found) {
      log.error(`No project with id ${project}`)
      process.exit(ExitCode.FatalError)
    }
    const created = await mintProjectToken(String(found.id), scope, uploadTokenName(options.name))
    if (options.out) {
      writeFileSync(options.out, created.token, { mode: 0o600 })
      chmodSync(options.out, 0o600)
      log.success(`Token ${created.id} (${scope}) for ${found.name} written to ${options.out}`)
    }
    else {
      // eslint-disable-next-line no-console
      console.log(created.token)
    }
    process.exit(ExitCode.Success)
  },
})
