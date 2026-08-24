-- The arbiter for the ingest upsert's ON CONFLICT (project_id, fingerprint).
--
-- Two identical unique indexes on these columns already exist —
-- issues_issues_project_fingerprint (0000000010) and issues_project_fingerprint
-- (0000000027) — and Postgres infers the arbiter from either without reporting
-- ambiguity. This statement is therefore a no-op on any database that has run
-- either of them.
--
-- It exists as a standing guarantee for a fresh or restored database. If the
-- arbiter index is ever absent, routes/errors.ts stops rolling repeats up and
-- starts raising "there is no unique or exclusion constraint matching the ON
-- CONFLICT specification" on EVERY repeat error for EVERY project — a total
-- ingest outage rather than a degradation. Do not delete this, and do not tidy
-- away the duplicate indexes in the same change that depends on them.
CREATE UNIQUE INDEX IF NOT EXISTS "issues_project_fingerprint"
  ON "issues" ("project_id", "fingerprint");
