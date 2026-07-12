-- Accentura schema migration
--
-- Run this ONCE against an existing D1 deployment whose `users` table was
-- created before the `today_audio_file_id` column was added.
--
-- Paste into: Cloudflare dashboard > D1 > your DB > Console > Execute.
--
-- Safe to re-run: SQLite will fail loudly with "duplicate column name"
-- if the column already exists — that error is expected and harmless on
-- a second run. If you see it, the migration is already applied.
--
-- Do NOT run this on a brand-new deployment — schema.sql already declares
-- the column in its CREATE TABLE.

ALTER TABLE users ADD COLUMN today_audio_file_id TEXT;

-- Optional sanity check — after running the ALTER, this should show the
-- new column in the users table definition:
--   SELECT sql FROM sqlite_master WHERE type='table' AND name='users';
