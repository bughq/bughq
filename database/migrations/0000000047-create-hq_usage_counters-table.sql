-- Usage counters in the shape @stacksjs/hq/meter counts into: one row per
-- (owner, meter, period), `used` as a whole number of units. This is the
-- package-owned schema (`usageCountersMigrationSql({ dialect: 'postgres',
-- table: 'hq_usage_counters' })`), written out here because production applies
-- only committed SQL.
--
-- Named `hq_usage_counters`, not the package default `usage_counters`: that
-- name already belongs to the table from 0000000039, which has a different
-- shape (owner_id, period, accepted, rejected). app/Billing/usage.ts points
-- the counter at this name.
--
-- `owner` is the account id as text (projects.owner_id), `meter` is `errors`
-- for events stored and `errors.dropped` for events sampled out past the
-- grace, `period` is `YYYY-MM` in UTC. No reset job: when the month turns the
-- key changes and the same upsert creates the next row.
--
-- Hand-written and additive; no app/Models/*.ts (see 0000000039 and 0000000043).
CREATE TABLE IF NOT EXISTS "hq_usage_counters" (
  "owner"      varchar(191) NOT NULL,
  "meter"      varchar(64)  NOT NULL,
  "period"     char(7)      NOT NULL,
  "used"       bigint       NOT NULL DEFAULT 0,
  "updated_at" timestamptz  DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("owner", "meter", "period")
);

-- Carry the counts already taken across, so an account's month does not
-- restart at zero on the deploy that begins enforcing the allowance.
-- `accepted` was every event stored; `rejected` was never written by anything
-- (nothing was refused before now) and is copied only where it is non-zero.
--
-- ON CONFLICT DO NOTHING makes this safe to run twice. The old table is left
-- exactly as it is: it is the record of past months.
INSERT INTO "hq_usage_counters" ("owner", "meter", "period", "used", "updated_at")
SELECT CAST("owner_id" AS varchar(191)), 'errors', "period", "accepted", "updated_at"
  FROM "usage_counters"
 WHERE "accepted" > 0
ON CONFLICT ("owner", "meter", "period") DO NOTHING;

INSERT INTO "hq_usage_counters" ("owner", "meter", "period", "used", "updated_at")
SELECT CAST("owner_id" AS varchar(191)), 'errors.dropped', "period", "rejected", "updated_at"
  FROM "usage_counters"
 WHERE "rejected" > 0
ON CONFLICT ("owner", "meter", "period") DO NOTHING;
