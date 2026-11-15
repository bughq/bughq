-- Take back the per-project triage key added in 0000000050.
--
-- It was a second hand-rolled credential beside `read_key`: a plain-text key
-- in a column, one per project, with its own comparison code. Changing an
-- issue's status from a machine is now done with a Stacks personal access
-- token carrying the `issues:triage` scope (app/Support/access.ts), which is
-- hashed at rest, named, expiring and revocable, and needs no column here.
--
-- No key was ever issued, so nothing is lost.
DROP INDEX IF EXISTS "projects_triage_key_unique";
ALTER TABLE "projects" DROP COLUMN IF EXISTS "triage_key";
ALTER TABLE "projects" DROP COLUMN IF EXISTS "triage_key_last_used_at";
