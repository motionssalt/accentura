// src/content.js
// Content selection: pick a random content item for a user's current tier,
// avoiding items they've already used. Fall back to allowing repeats if the
// pool is exhausted (and log that case).

import { tierForDay } from './onboarding.js';

// Return { item, usedIds, repeatFallback } or { item: null } if pool for tier
// is completely empty.
export async function pickContentForUser(db, user) {
  const tier = tierForDay(user.level, user.current_day);
  let usedIds = [];
  try {
    usedIds = JSON.parse(user.used_content_ids || '[]');
    if (!Array.isArray(usedIds)) usedIds = [];
  } catch {
    usedIds = [];
  }

  // Try to pick an unused item first.
  const excluded = usedIds.length > 0 ? usedIds : [-1]; // avoid empty IN()
  const placeholders = excluded.map(() => '?').join(',');
  const unusedStmt = db.prepare(
    `SELECT * FROM content_pool
      WHERE tier = ?
        AND id NOT IN (${placeholders})
      ORDER BY RANDOM()
      LIMIT 1`,
  );
  const unused = await unusedStmt.bind(tier, ...excluded).first();

  if (unused) {
    return { item: unused, usedIds, repeatFallback: false };
  }

  // Pool exhausted for this tier — allow repeats.
  const anyStmt = db.prepare(
    `SELECT * FROM content_pool WHERE tier = ? ORDER BY RANDOM() LIMIT 1`,
  );
  const any = await anyStmt.bind(tier).first();

  if (!any) {
    console.warn(`Content pool for tier ${tier} is EMPTY. Seed content-seed.sql.`);
    return { item: null, usedIds, repeatFallback: false };
  }

  console.warn(
    `Content pool for tier ${tier} exhausted for user ${user.telegram_id}. ` +
      `Falling back to repeats.`,
  );
  return { item: any, usedIds, repeatFallback: true };
}
