// src/webhook.js
// Telegram update handler & command router.

import {
  sendMessage,
  sendAudio,
  answerCallbackQuery,
  inlineKeyboard,
} from './telegram.js';
import { isChannelMember, sendJoinGate } from './channelGate.js';
import {
  handleStart,
  handleRestart,
  handleOnboardingCallback,
  ACCENTS,
  LEVELS,
} from './onboarding.js';
import { getUser, setTodayContent } from './db.js';
import { pickContentForUser } from './content.js';
import { synthesize } from './tts.js';
import {
  isAdmin,
  handleSetCap,
  handleStats,
  handleBroadcast,
} from './admin.js';

// -----------------------------------------------------------------------------
// Entry point invoked from src/index.js
// -----------------------------------------------------------------------------
export async function handleUpdate(env, update) {
  try {
    if (update.callback_query) {
      await handleCallbackQuery(env, update.callback_query);
      return;
    }
    if (update.message) {
      await handleMessage(env, update.message);
      return;
    }
    // Silently ignore other update types (edited_message, my_chat_member, etc.)
  } catch (err) {
    console.error('handleUpdate error:', err && err.stack ? err.stack : err);
  }
}

// -----------------------------------------------------------------------------
// Message handler
// -----------------------------------------------------------------------------
async function handleMessage(env, message) {
  const chatId = message.chat.id;
  const from = message.from;
  if (!from) return;
  const text = message.text || '';

  // Only respond to commands in private chats.
  if (message.chat.type !== 'private') return;

  // Channel gate: every command re-checks (no caching).
  const isMember = await isChannelMember(env, from.id);
  if (!isMember) {
    await sendJoinGate(env, chatId);
    return;
  }

  // Parse command + args.
  if (!text.startsWith('/')) {
    // Free-form text — just remind the user of the commands.
    await sendHelp(env, chatId);
    return;
  }

  // Support "/cmd@BotName args"
  const spaceIdx = text.indexOf(' ');
  const head = spaceIdx === -1 ? text : text.slice(0, spaceIdx);
  const args = spaceIdx === -1 ? '' : text.slice(spaceIdx + 1);
  const cmd = head.split('@')[0].toLowerCase();

  switch (cmd) {
    case '/start':
      await handleStart(env, chatId, from);
      return;

    case '/help':
      await sendHelp(env, chatId);
      return;

    case '/today':
      await handleToday(env, chatId, from);
      return;

    case '/status':
      await handleStatus(env, chatId, from);
      return;

    case '/restart':
      await handleRestart(env, chatId, from);
      return;

    case '/setaccent':
    case '/setlevel':
      await handleSettingsLocked(env, chatId, from, cmd);
      return;

    // --- Admin ---
    case '/setcap':
      if (!isAdmin(env, from.id)) return;
      await handleSetCap(env, chatId, args);
      return;

    case '/stats':
      if (!isAdmin(env, from.id)) return;
      await handleStats(env, chatId);
      return;

    case '/broadcast':
      if (!isAdmin(env, from.id)) return;
      await handleBroadcast(env, chatId, args);
      return;

    default:
      await sendHelp(env, chatId);
  }
}

async function sendHelp(env, chatId) {
  await sendMessage(
    env.TELEGRAM_BOT_TOKEN,
    chatId,
    `<b>Accentura commands</b>\n\n` +
      `/start — begin (or resume) your 30-day run\n` +
      `/today — get today's practice audio\n` +
      `/status — see your progress\n` +
      `/restart — start a new 30-day run (only after finishing the current one)\n` +
      `/setaccent, /setlevel — locked until you finish 30 days\n` +
      `/help — this message`,
  );
}

async function handleStatus(env, chatId, tgUser) {
  const user = await getUser(env.DB, tgUser.id);
  if (!user || !user.accent_key) {
    await sendMessage(
      env.TELEGRAM_BOT_TOKEN,
      chatId,
      `You haven't started yet. Send /start to pick an accent and level.`,
    );
    return;
  }
  const accentLabel = ACCENTS[user.accent_key]?.label || user.accent_key;
  const levelLabel = LEVELS[user.level]?.label || user.level;
  if (user.locked === 1 && user.current_day <= 30) {
    await sendMessage(
      env.TELEGRAM_BOT_TOKEN,
      chatId,
      `Accent: <b>${accentLabel}</b>\n` +
        `Level:  <b>${levelLabel}</b>\n` +
        `Progress: <b>Day ${user.current_day} of 30</b>`,
    );
  } else if (user.completed_at) {
    await sendMessage(
      env.TELEGRAM_BOT_TOKEN,
      chatId,
      `🎉 You've completed a 30-day run.\nSend /restart to begin a new one.`,
    );
  } else {
    await sendMessage(
      env.TELEGRAM_BOT_TOKEN,
      chatId,
      `You're between runs. Send /start to begin.`,
    );
  }
}

async function handleSettingsLocked(env, chatId, tgUser, cmd) {
  const user = await getUser(env.DB, tgUser.id);
  if (user && user.locked === 1 && user.current_day <= 30) {
    await sendMessage(
      env.TELEGRAM_BOT_TOKEN,
      chatId,
      `🔒 You can't change your accent or level while you're locked into a 30-day run.\n\n` +
        `You're on Day <b>${user.current_day} of 30</b>. Finish the run, then use /restart.`,
    );
    return;
  }
  // Not locked -> guide to /start or /restart.
  await sendMessage(
    env.TELEGRAM_BOT_TOKEN,
    chatId,
    cmd === '/setaccent'
      ? `Use /start (or /restart if you finished a previous run) to pick a new accent.`
      : `Use /start (or /restart if you finished a previous run) to pick a new level.`,
  );
}

// -----------------------------------------------------------------------------
// /today — fetch (or reuse) today's item, synthesize, send as audio + caption.
// Does NOT increment current_day (only the cron does that).
// -----------------------------------------------------------------------------
async function handleToday(env, chatId, tgUser) {
  const user = await getUser(env.DB, tgUser.id);
  if (!user || !user.accent_key) {
    await sendMessage(
      env.TELEGRAM_BOT_TOKEN,
      chatId,
      `You haven't started yet. Send /start to begin.`,
    );
    return;
  }
  if (user.completed_at || user.current_day > 30) {
    await sendMessage(
      env.TELEGRAM_BOT_TOKEN,
      chatId,
      `🎉 You've completed your 30-day run. Send /restart to begin a new one.`,
    );
    return;
  }

  await deliverTodayItem(env, user, chatId, /* isManual */ true);
}

// Shared delivery routine used by /today AND by the scheduled cron.
export async function deliverTodayItem(env, user, chatId, isManual) {
  // Reuse today's cached pick if it exists; otherwise select fresh.
  let contentItem = null;
  let usedIds = [];
  try {
    usedIds = JSON.parse(user.used_content_ids || '[]');
    if (!Array.isArray(usedIds)) usedIds = [];
  } catch {
    usedIds = [];
  }

  if (user.today_content_id) {
    contentItem = await env.DB
      .prepare('SELECT * FROM content_pool WHERE id = ?')
      .bind(user.today_content_id)
      .first();
  }

  if (!contentItem) {
    const pick = await pickContentForUser(env.DB, user);
    if (!pick.item) {
      await sendMessage(
        env.TELEGRAM_BOT_TOKEN,
        chatId,
        `⚠️ No content is available for your tier yet. Please check back later — an admin needs to seed the content pool.`,
      );
      return;
    }
    contentItem = pick.item;
    if (!usedIds.includes(contentItem.id)) usedIds.push(contentItem.id);
    await setTodayContent(env.DB, user.telegram_id, contentItem.id, JSON.stringify(usedIds));
  }

  // Synthesize.
  const tts = await synthesize(env, user.accent_prompt, contentItem.text);
  if (!tts.ok) {
    await sendMessage(
      env.TELEGRAM_BOT_TOKEN,
      chatId,
      `🔊 Audio generation is temporarily unavailable. Please try /today again in a few minutes.`,
    );
    return;
  }

  const accentLabel = ACCENTS[user.accent_key]?.label || user.accent_key;
  const typeLabel = contentItem.type === 'quote' ? '💬 Quote' : '💡 Fact';
  const caption =
    `<b>Day ${user.current_day} of 30 · ${accentLabel}</b>\n` +
    `${typeLabel}\n\n` +
    escapeHtml(contentItem.text);

  await sendAudio(
    env.TELEGRAM_BOT_TOKEN,
    chatId,
    tts.wavBytes,
    `accentura_day${user.current_day}.wav`,
    caption,
  );

  if (isManual) {
    // Manual /today shouldn't advance the day; that's the cron's job.
    // Nothing more to do here.
  }
}

function escapeHtml(s) {
  return String(s)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

// -----------------------------------------------------------------------------
// Callback queries (inline button taps)
// -----------------------------------------------------------------------------
async function handleCallbackQuery(env, cb) {
  const from = cb.from;
  if (!from) return;

  const data = cb.data || '';

  // Gate re-check button.
  if (data === 'gate:recheck') {
    const ok = await isChannelMember(env, from.id);
    if (ok) {
      await answerCallbackQuery(env.TELEGRAM_BOT_TOKEN, cb.id, '✅ You’re in!');
      await sendMessage(
        env.TELEGRAM_BOT_TOKEN,
        cb.message.chat.id,
        `Great, you're in. Send /start to begin.`,
      );
    } else {
      await answerCallbackQuery(
        env.TELEGRAM_BOT_TOKEN,
        cb.id,
        `Still not seeing you in the channel. Please join and try again.`,
        true,
      );
    }
    return;
  }

  // All other callbacks require channel membership too.
  const isMember = await isChannelMember(env, from.id);
  if (!isMember) {
    await answerCallbackQuery(
      env.TELEGRAM_BOT_TOKEN,
      cb.id,
      `Please join our channel first.`,
      true,
    );
    await sendJoinGate(env, cb.message.chat.id);
    return;
  }

  // Onboarding callbacks: accent:<key> and level:<accent>:<level>
  const handled = await handleOnboardingCallback(env, cb);
  if (handled) return;

  // Unknown callback data.
  await answerCallbackQuery(env.TELEGRAM_BOT_TOKEN, cb.id);
}
