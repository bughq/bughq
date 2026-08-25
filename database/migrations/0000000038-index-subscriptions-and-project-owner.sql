-- Two indexes the app has always needed and never had.
--
-- `subscriptions` carries uniques on provider_id and uuid only, so every
-- entitlement lookup — which filters on (user_id, type) — is a sequential scan.
-- That is invisible at zero rows and becomes a per-request scan of the whole
-- table the moment anyone subscribes.
CREATE INDEX IF NOT EXISTS "subscriptions_user_type"
  ON "subscriptions" ("user_id", "type");

-- `projects.owner_id` has no index either, despite being how every "which
-- account does this belong to" question is answered. Postgres does not index
-- the referencing side of a foreign key, and subscriptions_user_id_fk gave a
-- false sense that it did.
CREATE INDEX IF NOT EXISTS "projects_owner"
  ON "projects" ("owner_id");
