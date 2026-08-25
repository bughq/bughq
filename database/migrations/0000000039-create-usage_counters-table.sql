-- Per-account monthly event counts, for the Free plan's advertised cap.
--
-- Do NOT create app/Models/UsageCounter.ts for this table. Adding a model
-- regenerates every migration from models and deletes hand-written ones; the
-- untracked 0000000025-0000000030 files are exactly that damage.
--
-- Why not reuse rateLimit() from app/Errors/limits.ts, which already does
-- windowed counting — four reasons, so nobody re-proposes it:
--   1. Its state is a process-local Map (limits.ts:27). A deploy resets every
--      account's monthly usage to zero. Invisible for a 10s window, fatal for
--      a 30-day one.
--   2. Its two backends disagree on overflow: the in-memory path stops
--      incrementing at the cap while the Redis path keeps counting, so the same
--      meter reports two different numbers.
--   3. It is consume-only. Neither exported function reads a count, so no
--      screen could ever render "3,412 of 5,000".
--   4. Its windows are anchored at first hit, giving every account a different
--      and unexplainable reset date. "5k errors / mo" means a calendar month.
--
-- owner_id is `integer` to match projects.owner_id, not bigint.
--
-- No foreign key, deliberately: projects.owner_id has none either, and a FK
-- would let one orphaned owner abort a bookkeeping write. Ingest must never
-- fail on accounting.
--
-- No reset job. `period` is the first seven characters of the ISO timestamp the
-- ingest already computes, so when the month turns the key changes and the same
-- upsert creates the next row.
--
-- Never pruned: this is what a billing dispute is settled with.
CREATE TABLE IF NOT EXISTS "usage_counters" (
  "owner_id"    integer     NOT NULL,
  "period"      char(7)     NOT NULL,
  "accepted"    bigint      NOT NULL DEFAULT 0,
  "rejected"    bigint      NOT NULL DEFAULT 0,
  "notified_at" timestamptz,
  "updated_at"  timestamptz NOT NULL DEFAULT NOW(),
  PRIMARY KEY ("owner_id", "period")
);
