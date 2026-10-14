-- Debug files: what turns a native crash's addresses back into code.
--
-- Two kinds, one table, because both answer the same question ("which build
-- produced this frame?") and the settings page lists them together:
--
--   apple     A symbol map built from a dSYM, one row per binary. Keyed by
--             the binary's LC_UUID (`debug_id`), which every iOS frame carries,
--             so a crash finds its symbols without knowing the release at all.
--   proguard  An R8/ProGuard mapping.txt. Android frames carry no build id, so
--             the mapping is keyed by the release the app reports
--             (`1.0.0+41`), which the upload names explicitly.
--
-- `content` is the gzipped, base64'd payload. Kept in Postgres rather than on
-- the box's disk: the box is replaced on deploy, and a symbol map lost with it
-- would leave every crash of a live build unreadable. A real app's map is a few
-- megabytes, comfortably inside a TOASTed text column.
--
-- Hand-written and additive; no app/Models/*.ts (see 0000000043).
CREATE TABLE IF NOT EXISTS "debug_files" (
  "id"            varchar(32)  PRIMARY KEY,
  "project_id"    varchar(255) NOT NULL REFERENCES "projects" ("id") ON DELETE CASCADE,
  "kind"          varchar(16)  NOT NULL,
  "debug_id"      varchar(128) NOT NULL,
  "code_name"     varchar(255),
  "arch"          varchar(32),
  "release"       varchar(128),
  "symbol_count"  integer      NOT NULL DEFAULT 0,
  "size_bytes"    integer      NOT NULL DEFAULT 0,
  "content"       text         NOT NULL,
  "uploaded_by"   varchar(32),
  "created_at"    timestamptz  NOT NULL DEFAULT NOW()
);

-- One file per (project, kind, id): a re-upload of the same build replaces it.
CREATE UNIQUE INDEX IF NOT EXISTS "debug_files_identity" ON "debug_files" ("project_id", "kind", "debug_id");
