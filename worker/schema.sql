-- Schema of the registrations database (Cloudflare D1).
-- Apply via MCP (d1_database_query) or locally:
--   wrangler d1 execute winsener-meisterschaften --remote --file=worker/schema.sql

CREATE TABLE IF NOT EXISTS registrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL,
  competition TEXT NOT NULL,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  club TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  note TEXT,
  player_id TEXT,
  lk TEXT,
  status TEXT NOT NULL DEFAULT 'new',
  ip TEXT
);

CREATE INDEX IF NOT EXISTS idx_registrations_status ON registrations (status);
CREATE INDEX IF NOT EXISTS idx_registrations_player_id ON registrations (player_id);
