-- Per-account monthly usage, one row per (owner, meter, period), in the shape
-- `@stacksjs/hq/meter` counts into. The statement is the package's own
-- (`usageCountersMigrationSql({ dialect: 'postgres', table: 'hq_usage_counters' })`),
-- copied here because production applies committed files and generates none.
--
-- Not named `usage_counters`: 0000000039 already created a table of that name
-- with a different shape (owner_id, period, accepted, rejected). That table is
-- left exactly as it is. It is no longer written, and it stays as the record of
-- what was counted while the allowance was measured but not enforced.
--
-- `owner` is the account id as text, because the package meters accounts for
-- every HQ service and not all of them key an account by integer.
--
-- Hand-written and additive; no app/Models/*.ts (see 0000000039).
CREATE TABLE IF NOT EXISTS hq_usage_counters (
  owner VARCHAR(191) NOT NULL,
  meter VARCHAR(64) NOT NULL,
  period CHAR(7) NOT NULL,
  used BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (owner, meter, period)
);

-- Carry the history over so a usage screen has more than one month to show:
-- accepted -> 'errors', rejected -> 'errors.dropped'.
--
-- COMPLETED months only, on purpose. The month this runs in is left out, so
-- every account starts the new, enforced allowance from zero on the day it
-- ships rather than being sampled at once for errors it sent while the page
-- still said 5,000. The old table keeps that month's pre-enforcement count.
INSERT INTO hq_usage_counters (owner, meter, period, used, updated_at)
SELECT CAST(owner_id AS VARCHAR(191)), 'errors', period, accepted, updated_at
  FROM usage_counters
 WHERE accepted > 0 AND period < to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM')
ON CONFLICT (owner, meter, period) DO NOTHING;

INSERT INTO hq_usage_counters (owner, meter, period, used, updated_at)
SELECT CAST(owner_id AS VARCHAR(191)), 'errors.dropped', period, rejected, updated_at
  FROM usage_counters
 WHERE rejected > 0 AND period < to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM')
ON CONFLICT (owner, meter, period) DO NOTHING;
