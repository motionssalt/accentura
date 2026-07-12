// src/db.js
// Thin helpers around env.DB (Cloudflare D1).

export async function getUser(db, telegramId) {
  const row = await db
    .prepare('SELECT * FROM users WHERE telegram_id = ?')
    .bind(telegramId)
    .first();
  return row || null;
}

export async function upsertUserOnStart(db, telegramId, username) {
  // Create a bare row if none exists; do NOT touch existing progress.
  await db
    .prepare(
      `INSERT INTO users (telegram_id, username, current_day, locked, used_content_ids)
       VALUES (?, ?, 1, 0, '[]')
       ON CONFLICT(telegram_id) DO UPDATE SET username = excluded.username`
    )
    .bind(telegramId, username || null)
    .run();
}

export async function lockInUser(db, telegramId, accentKey, accentPrompt, level) {
  const nowIso = new Date().toISOString();
  await db
    .prepare(
      `UPDATE users
         SET accent_key           = ?,
             accent_prompt        = ?,
             level                = ?,
             current_day          = 1,
             locked               = 1,
             used_content_ids     = '[]',
             today_content_id     = NULL,
             today_audio_file_id  = NULL,
             started_at           = ?,
             completed_at         = NULL
       WHERE telegram_id = ?`
    )
    .bind(accentKey, accentPrompt, level, nowIso, telegramId)
    .run();
}

export async function setTodayContent(db, telegramId, contentId, usedIdsJson) {
  await db
    .prepare(
      `UPDATE users
         SET today_content_id = ?, used_content_ids = ?
       WHERE telegram_id = ?`
    )
    .bind(contentId, usedIdsJson, telegramId)
    .run();
}

// Persist the Telegram file_id of today's synthesized audio so subsequent
// /today calls (or cron reruns) can resend the same file without paying
// another Gemini TTS call. Cleared by advanceDay() when the day rolls over.
export async function setTodayAudioFileId(db, telegramId, fileId) {
  await db
    .prepare(
      `UPDATE users
         SET today_audio_file_id = ?
       WHERE telegram_id = ?`
    )
    .bind(fileId || null, telegramId)
    .run();
}

export async function advanceDay(db, telegramId, nextDay) {
  // Advancing the day invalidates any cached content + audio for the
  // previous day — clear both so the next delivery generates fresh content.
  await db
    .prepare(
      `UPDATE users
         SET current_day         = ?,
             today_content_id    = NULL,
             today_audio_file_id = NULL
       WHERE telegram_id = ?`
    )
    .bind(nextDay, telegramId)
    .run();
}

export async function markCompleted(db, telegramId) {
  const nowIso = new Date().toISOString();
  await db
    .prepare(
      `UPDATE users
         SET completed_at = ?, locked = 0
       WHERE telegram_id = ?`
    )
    .bind(nowIso, telegramId)
    .run();
}

export async function getConfig(db, key, fallback = null) {
  const row = await db
    .prepare('SELECT value FROM config WHERE key = ?')
    .bind(key)
    .first();
  return row ? row.value : fallback;
}

export async function setConfig(db, key, value) {
  await db
    .prepare(
      `INSERT INTO config (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    )
    .bind(key, String(value))
    .run();
}

export async function countActiveUsers(db) {
  const row = await db
    .prepare('SELECT COUNT(*) AS n FROM users WHERE locked = 1')
    .first();
  return row ? row.n : 0;
}

export async function countAllUsers(db) {
  const row = await db.prepare('SELECT COUNT(*) AS n FROM users').first();
  return row ? row.n : 0;
}

export async function countCompletedUsers(db) {
  const row = await db
    .prepare('SELECT COUNT(*) AS n FROM users WHERE completed_at IS NOT NULL')
    .first();
  return row ? row.n : 0;
}

export async function countByAccent(db) {
  const { results } = await db
    .prepare(
      `SELECT accent_key, COUNT(*) AS n
         FROM users
        WHERE accent_key IS NOT NULL
        GROUP BY accent_key
        ORDER BY n DESC`
    )
    .all();
  return results || [];
}

export async function listAllUserIds(db) {
  const { results } = await db.prepare('SELECT telegram_id FROM users').all();
  return (results || []).map((r) => r.telegram_id);
}

export async function listLockedUsers(db) {
  const { results } = await db
    .prepare(
      `SELECT *
         FROM users
        WHERE locked = 1 AND current_day <= 30`
    )
    .all();
  return results || [];
}

// --- API key cooldown status ------------------------------------------------

export async function getKeyStatuses(db) {
  const { results } = await db.prepare('SELECT * FROM api_key_status').all();
  const map = new Map();
  for (const r of results || []) map.set(r.key_index, r.cooldown_until);
  return map;
}

export async function setKeyCooldown(db, keyIndex, cooldownUntilIso) {
  await db
    .prepare(
      `INSERT INTO api_key_status (key_index, cooldown_until) VALUES (?, ?)
       ON CONFLICT(key_index) DO UPDATE SET cooldown_until = excluded.cooldown_until`
    )
    .bind(keyIndex, cooldownUntilIso)
    .run();
}

export async function clearKeyCooldown(db, keyIndex) {
  await db
    .prepare('DELETE FROM api_key_status WHERE key_index = ?')
    .bind(keyIndex)
    .run();
}
