import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const projectRoot = resolve(import.meta.dir, '../..')

function trackedMigrationFiles(): string[] {
  const result = Bun.spawnSync({
    cmd: ['git', 'ls-files', 'database/migrations/*.sql'],
    cwd: projectRoot,
    stderr: 'pipe',
    stdout: 'pipe',
  })

  expect(result.exitCode).toBe(0)

  return result.stdout
    .toString()
    .trim()
    .split('\n')
    .filter(Boolean)
}

describe('migration reproducibility', () => {
  test('each committed migration number is unique', () => {
    const numbers = trackedMigrationFiles().map((file) => file.match(/\/(\d{10})-/)?.[1])

    expect(numbers.every(Boolean)).toBe(true)
    expect(new Set(numbers).size).toBe(numbers.length)
  })

  test('each table has exactly one committed CREATE migration', () => {
    const creators = new Map<string, string[]>()

    for (const file of trackedMigrationFiles()) {
      const sql = readFileSync(resolve(projectRoot, file), 'utf8')

      for (const match of sql.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?["`]?([a-zA-Z0-9_]+)/gi)) {
        const table = match[1]!.toLowerCase()
        creators.set(table, [...(creators.get(table) ?? []), file])
      }
    }

    const duplicates = [...creators]
      .filter(([, files]) => files.length > 1)
      .map(([table, files]) => ({ files, table }))

    expect(duplicates).toEqual([])
  })

  test('production applies committed migrations without generating files', () => {
    const workflow = readFileSync(resolve(projectRoot, '.github/workflows/deploy.yml'), 'utf8')

    expect(workflow).toMatch(/buddy\/dist\/cli\.js migrate --no-generate/)
  })
})
