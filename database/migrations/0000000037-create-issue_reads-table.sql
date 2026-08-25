-- Per-user read watermarks. Unread is NOT stored — it is derived as
--   (r.user_id IS NULL OR issues.count > r.seen_count)
-- so a repeat occurrence re-bolds the thread for every member with ZERO writes
-- on the ingest path, regardless of member count. A stored `unread` boolean
-- would cost one write per member per event on the busiest endpoint in the app.
--
-- Watermarked on seen_count, not a timestamp. `last_seen` is minted by the app
-- server (new Date().toISOString()) while any NOW() watermark is minted by
-- Postgres — two clocks, on two machines in production, and any drift between
-- them silently swallows a re-bold. `count` is monotonic and cast-free, which
-- also keeps the list query away from `last_seen::timestamptz`, where one
-- malformed varchar would blank the whole dashboard.
--
-- Per USER, not per issue: `status` is a claim about the codebase, but unread is
-- a claim about one person's attention. A shared column would mean one teammate
-- opening an issue un-bolds it for everyone else, for something they never saw.
--
-- user_id is bigint because users.id is BIGSERIAL, unlike every other id in this
-- schema; varchar is rejected outright as an incompatible FK type.
--
-- ON DELETE CASCADE on issue_id means deleting a project cleans this up with no
-- edit to that route, unlike project_members and project_invites which it has to
-- delete by hand.
CREATE TABLE IF NOT EXISTS "issue_reads" (
  "user_id"    bigint       NOT NULL REFERENCES "users" ("id") ON DELETE CASCADE,
  "issue_id"   varchar(255) NOT NULL REFERENCES "issues" ("id") ON DELETE CASCADE,
  "project_id" varchar(255) NOT NULL,
  "seen_at"    timestamptz  NOT NULL DEFAULT NOW(),
  "seen_count" integer      NOT NULL DEFAULT 0,
  PRIMARY KEY ("user_id", "issue_id")
);

CREATE INDEX IF NOT EXISTS "issue_reads_user_project"
  ON "issue_reads" ("user_id", "project_id");

-- Draw the line on the day this ships: everything that exists now counts as
-- already read, at its CURRENT count, for everyone who can already see it.
-- Without this, the first load after deploy is a wall of bold, and the bold
-- would mean "predates the feature" rather than "fired since you looked" — the
-- one thing it must never mean. Owners first.
INSERT INTO "issue_reads" ("user_id", "issue_id", "project_id", "seen_at", "seen_count")
SELECT u.id, i.id, i.project_id, NOW(), COALESCE(i.count, 0)
  FROM "issues" i
  JOIN "projects" p ON p.id = i.project_id
  JOIN "users" u    ON u.id = p.owner_id
ON CONFLICT ("user_id", "issue_id") DO NOTHING;

-- Then members. project_members is email-keyed, so an invitee who has not signed
-- up yet simply produces no row and is seeded when they accept. Nothing may
-- follow this statement but a newline: the migration runner appends a semicolon
-- to the last line without checking whether it is a comment.
INSERT INTO "issue_reads" ("user_id", "issue_id", "project_id", "seen_at", "seen_count")
SELECT u.id, i.id, i.project_id, NOW(), COALESCE(i.count, 0)
  FROM "project_members" m
  JOIN "users"  u ON lower(u.email) = lower(m.email)
  JOIN "issues" i ON i.project_id = m.project_id
ON CONFLICT ("user_id", "issue_id") DO NOTHING;
