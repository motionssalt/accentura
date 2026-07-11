-- Accentura D1 schema
-- Run this once in the D1 console (Cloudflare dashboard > D1 > your DB > Console).
-- Safe to re-run: all statements use IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS users (
  telegram_id       INTEGER PRIMARY KEY,
  username          TEXT,
  accent_key        TEXT,
  accent_prompt     TEXT,
  level             TEXT,
  current_day       INTEGER DEFAULT 1,
  locked            INTEGER DEFAULT 1,
  used_content_ids  TEXT    DEFAULT '[]',
  today_content_id  INTEGER,
  started_at        TEXT,
  completed_at      TEXT
);

CREATE TABLE IF NOT EXISTS content_pool (
  id    INTEGER PRIMARY KEY AUTOINCREMENT,
  tier  INTEGER NOT NULL,      -- 1..4
  type  TEXT    NOT NULL,      -- 'fact' | 'quote'
  text  TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_content_pool_tier ON content_pool(tier);

CREATE TABLE IF NOT EXISTS config (
  key   TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS api_key_status (
  key_index      INTEGER PRIMARY KEY,
  cooldown_until TEXT
);

-- Seed a couple of sane config defaults (won't overwrite existing values).
INSERT OR IGNORE INTO config (key, value) VALUES ('user_cap', '500');
INSERT OR IGNORE INTO config (key, value) VALUES ('active_key_index', '0');

-- NOTE: content_pool is INTENTIONALLY EMPTY. Populate it later using
-- content-seed.sql (or your own seed file) via the D1 console.
