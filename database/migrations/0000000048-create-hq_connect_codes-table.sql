-- Pending and approved `buddy hq:connect` attempts (routes/hq.ts).
--
-- The statement is `connectCodesMigrationSql()` from `@stacksjs/hq/service`,
-- copied here because production applies committed files and generates none.
--
-- No secret is at rest in this table. `code_hash` is the SHA-256 of the code
-- the CLI holds, and `sealed_grant` is the project's keys encrypted under a key
-- derived from that code, so a copy of the table yields neither a code that
-- can be polled nor a key. Rows live ten minutes and are pruned whenever a new
-- code is issued.
--
-- Hand-written and additive; no app/Models/*.ts (see 0000000039).
CREATE TABLE IF NOT EXISTS hq_connect_codes (
  code_hash CHAR(64) NOT NULL,
  app VARCHAR(64) NOT NULL,
  status VARCHAR(16) NOT NULL,
  sealed_grant TEXT,
  claim CHAR(36),
  expires_at BIGINT NOT NULL,
  PRIMARY KEY (code_hash)
);
