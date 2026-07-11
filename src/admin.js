// src/admin.js
// Admin-only commands: /setcap, /stats, /broadcast.

import { sendMessage } from './telegram.js';
import {
  getConfig,
  setConfig,
  countActiveUsers,
  countAllUsers,
  countCompletedUsers,
  countByAccent,
  listAllUserIds,
} from './db.js';
import { ACCENTS } from './onboarding.js';

export function isAdmin(env, telegramUserId) {
  const raw = env.ADMIN_IDS || '';
  const ids = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => parseInt(s, 10))
    .filter((n) => Number.isFinite(n));
  return ids.includes(telegramUserId);
}

export async function handleSetCap(env, chatId, argText) {
  const n = parseInt((argText || '').trim(), 10);
  if (!Number.isFinite(n) || n < 0) {
    await sendMessage(
      env.TELEGRAM_BOT_TOKEN,
      chatId,
      `Usage: <code>/setcap &lt;number&gt;</code>\n` +
        `Use <code>0</code> or a negative number to remove the cap (unlimited).`,
    );
    return;
  }
  const value = n <= 0 ? '0' : String(n);
  await setConfig(env.DB, 'user_cap', value);
  await sendMessage(
    env.TELEGRAM_BOT_TOKEN,
    chatId,
    n <= 0
      ? `✅ Cap removed — user registration is now unlimited.`
      : `✅ User cap set to <b>${n}</b>.`,
  );
}

export async function handleStats(env, chatId) {
  const [total, active, completed, byAccent, capStr] = await Promise.all([
    countAllUsers(env.DB),
    countActiveUsers(env.DB),
    countCompletedUsers(env.DB),
    countByAccent(env.DB),
    getConfig(env.DB, 'user_cap', env.DEFAULT_USER_CAP || '500'),
  ]);

  const cap = parseInt(capStr, 10);
  const capLine =
    Number.isFinite(cap) && cap > 0 ? `${cap}` : 'unlimited';

  const accentLines =
    byAccent.length === 0
      ? '  (none yet)'
      : byAccent
          .map((r) => {
            const label = ACCENTS[r.accent_key]?.label || r.accent_key;
            return `  • ${label}: <b>${r.n}</b>`;
          })
          .join('\n');

  const msg =
    `📊 <b>Accentura stats</b>\n\n` +
    `Total users:     <b>${total}</b>\n` +
    `Active (locked): <b>${active}</b>\n` +
    `Completed:       <b>${completed}</b>\n` +
    `Current cap:     <b>${capLine}</b>\n\n` +
    `<b>By accent:</b>\n${accentLines}`;

  await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, msg);
}

export async function handleBroadcast(env, chatId, argText) {
  const text = (argText || '').trim();
  if (!text) {
    await sendMessage(
      env.TELEGRAM_BOT_TOKEN,
      chatId,
      `Usage: <code>/broadcast &lt;message&gt;</code>`,
    );
    return;
  }

  const ids = await listAllUserIds(env.DB);
  await sendMessage(
    env.TELEGRAM_BOT_TOKEN,
    chatId,
    `📣 Broadcasting to ${ids.length} users...`,
  );

  let sent = 0;
  let failed = 0;
  for (const id of ids) {
    try {
      const res = await sendMessage(env.TELEGRAM_BOT_TOKEN, id, text);
      if (res && res.ok) sent++;
      else failed++;
    } catch {
      failed++;
    }
    // Tiny delay to stay under Telegram's ~30 msg/sec global limit.
    await new Promise((r) => setTimeout(r, 40));
  }

  await sendMessage(
    env.TELEGRAM_BOT_TOKEN,
    chatId,
    `✅ Broadcast complete.\nSent: <b>${sent}</b>\nFailed: <b>${failed}</b>`,
  );
}
