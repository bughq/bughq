-- App sessions: the denominator for release health.
--
-- A crash count alone cannot say whether a build is worse than the last one:
-- 40 crashes is a disaster for a build with 200 launches and noise for one with
-- 200,000. The mobile SDKs report one session per app launch (offline-queued
-- like events), and a crash report names the session it ended. Crash-free
-- sessions for a release is then `1 - crashed / sessions`.
--
-- One row per session, keyed by the id the device generated, so a session sent
-- twice (an offline queue replayed after a timeout) counts once. `status` only
-- ever escalates: ok < errored < abnormal < crashed. A late "ok" ping can never
-- un-crash a session.
--
-- `user_hash` is a SHA-256 of the app's own user id, never the id itself, so
-- release health can count affected users without this table holding anyone's
-- identifier.
--
-- Hand-written and additive; no app/Models/*.ts (see 0000000043).
CREATE TABLE IF NOT EXISTS "app_sessions" (
  "project_id"  varchar(255) NOT NULL REFERENCES "projects" ("id") ON DELETE CASCADE,
  "id"          varchar(64)  NOT NULL,
  "release"     varchar(128) NOT NULL DEFAULT '',
  "environment" varchar(64)  NOT NULL DEFAULT 'production',
  "platform"    varchar(16),
  "status"      varchar(16)  NOT NULL DEFAULT 'ok',
  "errors"      integer      NOT NULL DEFAULT 0,
  "user_hash"   char(64),
  "started_at"  timestamptz  NOT NULL DEFAULT NOW(),
  "updated_at"  timestamptz  NOT NULL DEFAULT NOW(),
  PRIMARY KEY ("project_id", "id")
);

CREATE INDEX IF NOT EXISTS "app_sessions_release" ON "app_sessions" ("project_id", "release", "started_at");
