import type { SqlClient } from '@stacksjs/hq/meter'
import { Database } from 'bun:sqlite'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * An in-memory database shaped like the tables the HQ code touches, so the
 * real SQL in app/Hq/adapter.ts and the package's SQL stores run in a unit
 * test instead of being replaced by a fake.
 *
 * The app writes Postgres placeholders (`$1`); SQLite spells a numbered
 * parameter `?1`. That is the only translation made here.
 */
export function sqliteClient(db: Database): SqlClient {
  return {
    unsafe: async (sql: string, params: unknown[] = []) => {
      const bound = params.map(value => typeof value === 'boolean' ? (value ? 1 : 0) : value)
      return db.query(sql.replace(/\$(\d+)/g, '?$1')).all(...bound as never[])
    },
  }
}

const root = resolve(import.meta.dir, '../..')

export function migrationSql(file: string): string {
  return readFileSync(resolve(root, 'database/migrations', file), 'utf8')
}

export const USAGE_MIGRATION = '0000000047-create-hq_usage_counters-table.sql'
export const CONNECT_MIGRATION = '0000000048-create-hq_connect_codes-table.sql'

/**
 * `projects` as migrations 0000000001 and 0000000046 leave it, the previous
 * `usage_counters` from 0000000039, and then the two migrations this change
 * adds, executed from the committed files.
 */
export function hqDatabase(): Database {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE "projects" (
      "id" varchar(255) PRIMARY KEY,
      "name" varchar(255),
      "platform" varchar(255),
      "dsn" varchar(255),
      "ingest_key" varchar(255),
      "owner_id" integer,
      "is_active" boolean not null default true,
      "created_at" timestamp not null default CURRENT_TIMESTAMP,
      "updated_at" timestamp,
      "read_key" TEXT,
      "read_key_last_used_at" TEXT
    );
    CREATE TABLE "usage_counters" (
      "owner_id" integer NOT NULL,
      "period" char(7) NOT NULL,
      "accepted" bigint NOT NULL DEFAULT 0,
      "rejected" bigint NOT NULL DEFAULT 0,
      "notified_at" timestamptz,
      "updated_at" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY ("owner_id", "period")
    );
  `)
  return db
}

export function migrate(db: Database): void {
  db.exec(migrationSql(USAGE_MIGRATION))
  db.exec(migrationSql(CONNECT_MIGRATION))
}
