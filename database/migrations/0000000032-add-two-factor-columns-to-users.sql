-- The three columns the `useAuth` trait's login path reads, made explicit.
--
-- These are trait-derived: app/Models/User.ts declares `useAuth`, and the
-- framework's LoginAction calls getTwoFactorState, which runs
-- `SELECT two_factor_secret, two_factor_enabled FROM users`. Nothing in
-- database/migrations ever created them — 0000000005 creates only id, name,
-- email, password and the timestamps — so they existed only where a
-- model-driven schema sync had happened to run. On production it had not, and
-- every login with a CORRECT password returned 500 while a wrong one still
-- returned a clean 401: Auth.attempt succeeds first, then the missing column
-- throws. Reproduced locally by dropping these three and watching the pair of
-- responses match production exactly.
--
-- Written by hand rather than left to the trait because a column the login path
-- cannot run without should not depend on whether a generator happened to fire.
-- IF NOT EXISTS throughout, so this is a no-op wherever the sync did run.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "two_factor_secret" varchar(255);
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "two_factor_enabled" boolean NOT NULL DEFAULT false;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "two_factor_last_used_step" bigint;
