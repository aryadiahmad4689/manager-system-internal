-- Dashboard users
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  last_login DATETIME
);

-- Virtual Machines
CREATE TABLE IF NOT EXISTS vms (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  label TEXT NOT NULL,
  host TEXT NOT NULL,
  port INTEGER DEFAULT 22,
  username TEXT NOT NULL,
  encrypted_password TEXT NOT NULL,
  encryption_iv TEXT NOT NULL,
  encryption_auth_tag TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- VM Status tracking
CREATE TABLE IF NOT EXISTS vm_status (
  vm_id TEXT PRIMARY KEY REFERENCES vms(id) ON DELETE CASCADE,
  status TEXT CHECK(status IN ('online', 'offline', 'unreachable')) DEFAULT 'offline',
  last_checked DATETIME,
  fail_count INTEGER DEFAULT 0
);

-- Session tracking (for audit)
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME NOT NULL,
  is_active INTEGER DEFAULT 1
);

-- AI Provider settings
CREATE TABLE IF NOT EXISTS ai_settings (
  id TEXT PRIMARY KEY DEFAULT 'default',
  provider TEXT NOT NULL DEFAULT 'openai',
  api_key_encrypted TEXT NOT NULL DEFAULT '',
  api_key_iv TEXT NOT NULL DEFAULT '',
  api_key_auth_tag TEXT NOT NULL DEFAULT '',
  model TEXT NOT NULL DEFAULT 'gpt-4o-mini',
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Database Connections
CREATE TABLE IF NOT EXISTS database_connections (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  vm_id TEXT REFERENCES vms(id) ON DELETE SET NULL,
  db_type TEXT NOT NULL CHECK(db_type IN ('mysql', 'postgresql', 'mariadb')),
  host TEXT NOT NULL DEFAULT 'localhost',
  port INTEGER NOT NULL,
  db_username TEXT NOT NULL,
  encrypted_password TEXT NOT NULL,
  encryption_iv TEXT NOT NULL,
  encryption_auth_tag TEXT NOT NULL,
  label TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Query History
CREATE TABLE IF NOT EXISTS query_history (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  connection_id TEXT NOT NULL REFERENCES database_connections(id) ON DELETE CASCADE,
  database_name TEXT,
  query_text TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('success', 'error')),
  error_message TEXT,
  execution_time_ms INTEGER,
  row_count INTEGER,
  executed_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Index for efficient history lookup and cleanup
CREATE INDEX IF NOT EXISTS idx_query_history_connection 
  ON query_history(connection_id, executed_at DESC);
