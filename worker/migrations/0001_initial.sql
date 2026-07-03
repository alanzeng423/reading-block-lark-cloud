CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  lark_open_id TEXT NOT NULL UNIQUE,
  lark_union_id TEXT,
  tenant_key TEXT,
  name TEXT,
  email TEXT,
  encrypted_access_token TEXT NOT NULL,
  encrypted_refresh_token TEXT,
  access_token_expires_at INTEGER NOT NULL,
  refresh_token_expires_at INTEGER,
  token_scope TEXT,
  base_app_token TEXT,
  base_table_id TEXT,
  base_url TEXT,
  calendar_id TEXT,
  settings_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  last_seen_at INTEGER,
  user_agent TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_sessions_token_hash ON sessions(token_hash);
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);

CREATE TABLE IF NOT EXISTS oauth_states (
  state TEXT PRIMARY KEY,
  login_id TEXT NOT NULL UNIQUE,
  code_verifier TEXT NOT NULL,
  status TEXT NOT NULL,
  session_token TEXT,
  error TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_oauth_states_login_id ON oauth_states(login_id);

CREATE TABLE IF NOT EXISTS reading_items (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  base_record_id TEXT,
  url TEXT NOT NULL,
  title TEXT NOT NULL,
  domain TEXT,
  status TEXT NOT NULL,
  saved_at INTEGER NOT NULL,
  read_at INTEGER,
  scheduled_start INTEGER,
  scheduled_end INTEGER,
  calendar_event_id TEXT,
  batch_id TEXT,
  source_device TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_reading_items_user_status_saved
  ON reading_items(user_id, status, saved_at);
CREATE INDEX IF NOT EXISTS idx_reading_items_user_url_status
  ON reading_items(user_id, url, status);
CREATE INDEX IF NOT EXISTS idx_reading_items_batch
  ON reading_items(user_id, batch_id);

CREATE TABLE IF NOT EXISTS schedule_locks (
  user_id TEXT PRIMARY KEY,
  locked_until INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
