CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT,
  username TEXT,
  created_at TEXT NOT NULL,
  json_text TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  session_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT,
  json_text TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS profiles (
  user_id TEXT PRIMARY KEY,
  updated_at TEXT NOT NULL,
  json_text TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS strategy_profiles (
  user_id TEXT PRIMARY KEY,
  updated_at TEXT NOT NULL,
  json_text TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS global_policies (
  user_id TEXT PRIMARY KEY,
  updated_at TEXT NOT NULL,
  json_text TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS policy_history (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  json_text TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_policy_history_user_created
  ON policy_history (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS policy_proposals (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  status TEXT,
  created_at TEXT NOT NULL,
  json_text TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_policy_proposals_user_status
  ON policy_proposals (user_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS policy_audit_logs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  json_text TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_policy_audit_logs_user_time
  ON policy_audit_logs (user_id, timestamp DESC);

CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  status TEXT,
  priority TEXT,
  updated_at TEXT,
  json_text TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_jobs_user_updated
  ON jobs (user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS fit_assessments (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  job_id TEXT NOT NULL,
  updated_at TEXT,
  json_text TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_fit_assessments_user_job
  ON fit_assessments (user_id, job_id);

CREATE TABLE IF NOT EXISTS application_preps (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  job_id TEXT NOT NULL,
  updated_at TEXT,
  json_text TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_application_preps_user_job
  ON application_preps (user_id, job_id);

CREATE TABLE IF NOT EXISTS application_tasks (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  job_id TEXT,
  status TEXT,
  updated_at TEXT,
  json_text TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_application_tasks_user_job
  ON application_tasks (user_id, job_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS interview_reflections (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  job_id TEXT NOT NULL,
  updated_at TEXT,
  json_text TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_interview_reflections_user_job
  ON interview_reflections (user_id, job_id);

CREATE TABLE IF NOT EXISTS activity_logs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  job_id TEXT,
  timestamp TEXT NOT NULL,
  json_text TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_activity_logs_user_time
  ON activity_logs (user_id, timestamp DESC);

CREATE TABLE IF NOT EXISTS bad_cases (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  job_id TEXT NOT NULL,
  updated_at TEXT,
  json_text TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_bad_cases_user_job
  ON bad_cases (user_id, job_id);
