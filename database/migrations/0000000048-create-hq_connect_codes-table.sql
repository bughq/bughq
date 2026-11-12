-- Pending and approved `buddy hq:connect` attempts. The package-owned schema
-- for `sqlConnectCodeStore` from @stacksjs/hq/service
-- (`connectCodesMigrationSql()`), written out because production applies only
-- committed SQL.
--
-- The code itself is never stored. `code_hash` is its SHA-256, and
-- `sealed_grant` is the project's keys encrypted under a key derived from the
-- code, so a copy of this table yields neither a code that can be polled nor a
-- key. `claim` is how two concurrent polls of one approved code are told
-- apart: exactly one of them takes the keys.
--
-- Rows are short-lived. A code lives ten minutes, is deleted when its keys are
-- collected, and expired rows are pruned whenever a new connect starts.
-- `expires_at` is epoch milliseconds.
--
-- Hand-written and additive; no app/Models/*.ts (see 0000000043).
CREATE TABLE IF NOT EXISTS "hq_connect_codes" (
  "code_hash"    char(64)    NOT NULL,
  "app"          varchar(64) NOT NULL,
  "status"       varchar(16) NOT NULL,
  "sealed_grant" text,
  "claim"        char(36),
  "expires_at"   bigint      NOT NULL,
  PRIMARY KEY ("code_hash")
);
