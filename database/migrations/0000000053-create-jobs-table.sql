-- The job queue's tables (config/cloud.ts `queues`, app/Jobs, and the
-- framework's own jobs such as SendPasswordResetEmailJob).
--
-- NOTE ON STYLE: no semicolons in these comments. The migration runner splits
-- the file on semicolons without first stripping comment lines.
--
-- Why they were absent: in production the framework queues every dispatched
-- job to the database, and this app never had the tables or a worker. A
-- password reset answered "a link has been sent" while the dispatch failed
-- with `relation "jobs" does not exist`, so no email was ever sent.
--
-- These are the statements `buddy queue:table` writes for Postgres, copied
-- here because production applies committed files and generates none. The
-- file is named as that command names its own, so it recognises the tables as
-- already provided. `queue_workers` came with 0000000049.
-- The one addition is the index on jobs, which the worker's poll reads by.
--
-- `reserved_at` and `available_at` are seconds since the epoch.
--
-- Hand-written and additive, with no app/Models/*.ts behind it.
CREATE TABLE IF NOT EXISTS jobs (
  id SERIAL PRIMARY KEY,
  queue VARCHAR(255) NOT NULL DEFAULT 'default',
  payload TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  reserved_at INTEGER,
  available_at INTEGER,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS jobs_queue_available_at_index ON jobs (queue, available_at);

CREATE TABLE IF NOT EXISTS failed_jobs (
  id SERIAL PRIMARY KEY,
  uuid VARCHAR(255) NOT NULL,
  connection VARCHAR(255) NOT NULL,
  queue VARCHAR(255) NOT NULL,
  payload TEXT NOT NULL,
  exception TEXT NOT NULL,
  attempts INTEGER,
  max_attempts INTEGER,
  duration_ms INTEGER,
  failed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP
);

CREATE TABLE IF NOT EXISTS job_batches (
  id VARCHAR(255) PRIMARY KEY,
  name VARCHAR(255) NOT NULL DEFAULT '',
  total_jobs INTEGER NOT NULL DEFAULT 0,
  pending_jobs INTEGER NOT NULL DEFAULT 0,
  failed_jobs INTEGER NOT NULL DEFAULT 0,
  failed_job_ids TEXT NOT NULL DEFAULT '[]',
  options TEXT,
  cancelled_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  finished_at TIMESTAMP,
  then_handler TEXT,
  catch_handler TEXT,
  finally_handler TEXT
);

CREATE TABLE IF NOT EXISTS dead_letter_jobs (
  id SERIAL PRIMARY KEY,
  uuid VARCHAR(255) NOT NULL,
  connection VARCHAR(255) NOT NULL,
  queue VARCHAR(255) NOT NULL,
  payload TEXT NOT NULL,
  exception TEXT NOT NULL,
  reason VARCHAR(64) NOT NULL,
  total_failures INTEGER NOT NULL DEFAULT 1,
  first_failed_at TIMESTAMP,
  last_failed_at TIMESTAMP,
  dead_lettered_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS job_quarantine (
  id SERIAL PRIMARY KEY,
  job_name VARCHAR(255) NOT NULL,
  payload_hash VARCHAR(64) NOT NULL,
  failure_count INTEGER NOT NULL DEFAULT 0,
  window_start TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  quarantined_at TIMESTAMP,
  UNIQUE (job_name, payload_hash)
);

CREATE TABLE IF NOT EXISTS queue_circuit_state (
  queue_name VARCHAR(255) PRIMARY KEY,
  success_count INTEGER NOT NULL DEFAULT 0,
  failure_count INTEGER NOT NULL DEFAULT 0,
  window_start TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  paused_at TIMESTAMP,
  resume_at TIMESTAMP
);

CREATE TABLE IF NOT EXISTS job_idempotency (
  id SERIAL PRIMARY KEY,
  idempotency_key VARCHAR(255) NOT NULL UNIQUE,
  job_name VARCHAR(255) NOT NULL,
  queue VARCHAR(255) NOT NULL DEFAULT 'default',
  dispatched_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
