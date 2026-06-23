-- Schema der Anmeldungs-Datenbank (Cloudflare D1).
-- Anlegen via MCP (d1_database_query) oder lokal:
--   wrangler d1 execute winsener-meisterschaften --remote --file=worker/schema.sql

CREATE TABLE IF NOT EXISTS meldungen (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL,
  konkurrenz TEXT NOT NULL,
  vorname TEXT NOT NULL,
  nachname TEXT NOT NULL,
  verein TEXT NOT NULL,
  email TEXT NOT NULL,
  handy TEXT,
  anmerkung TEXT,
  lk TEXT,
  status TEXT NOT NULL DEFAULT 'neu',
  ip TEXT
);

CREATE INDEX IF NOT EXISTS idx_meldungen_status ON meldungen (status);
