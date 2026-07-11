// src/onboarding.js
// /start onboarding flow — accent picker, level picker, lock-in.

import {
  sendMessage,
  editMessageText,
  answerCallbackQuery,
  inlineKeyboard,
} from './telegram.js';
import {
  getUser,
  upsertUserOnStart,
  lockInUser,
  countActiveUsers,
  getConfig,
} from './db.js';

// -----------------------------------------------------------------------------
// Fixed accent catalogue. `prompt` is the string prepended to the TTS input so
// Gemini shapes the voice accordingly. Kept intentionally descriptive.
// -----------------------------------------------------------------------------
export const ACCENTS = {
  british_rp: {
    label: '🇬🇧 British RP',
    prompt:
      'Read the following in a clear Received Pronunciation accent — ' +
      'Southern British English, BBC newsreader style, unhurried and precise:',
  },
  scottish: {
    label: '🏴󠁧󠁢󠁳󠁣󠁴󠁿 Scottish',
    prompt:
      'Read the following in a warm Scottish accent — Central Belt / ' +
      'Edinburgh, rolled Rs, natural cadence, clearly intelligible to learners:',
  },
  irish: {
    label: '🇮🇪 Irish',
    prompt:
      'Read the following in a soft Irish accent — Dublin / Leinster, ' +
      'lyrical intonation, gentle pace, clearly enunciated:',
  },
  australian: {
    label: '🇦🇺 Australian',
    prompt:
      'Read the following in a friendly General Australian accent — ' +
      'relaxed vowels, rising terminals kept subtle, clear and confident:',
  },
  american_general: {
    label: '🇺🇸 American (General)',
    prompt:
      'Read the following in a neutral General American accent — ' +
      'rhotic Rs, clear consonants, standard US broadcast style:',
  },
  south_african: {
    label: '🇿🇦 South African',
    prompt:
      'Read the following in a General South African English accent — ' +
      'crisp vowels, moderate pace, professional and clearly intelligible:',
  },
};

export const LEVELS = {
  beginner:     { label: '🟢 Beginner',     tier: 1 },
  intermediate: { label: '🟡 Intermediate', tier: 2 },
  advanced:     { label: '🔴 Advanced',     tier: 3 },
  progressive:  { label: '🚀 Progressive',  tier: null }, // computed per-day
};

// Progressive tier mapping by day.
export function tierForDay(level, day) {
  if (level !== 'progressive') return LEVELS[level].tier;
  if (day <= 7)  return 1;
  if (day <= 15) return 2;
  if (day <= 23) return 3;
  return 4;
}

// ---------------------------------------------------------------------------
// /start handler
// ---------------------------------------------------------------------------
export async function handleStart(env, chatId, tgUser) {
  const existing = await getUser(env.DB, tgUser.id);

  // Case 1: locked returning user — show progress, no re-onboarding.
  if (existing && existing.locked === 1 && existing.current_day <= 30) {
    const accentLabel = ACCENTS[existing.accent_key]?.label || existing.accent_key;
    const levelLabel = LEVELS[existing.level]?.label || existing.level;
    await sendMessage(
      env.TELEGRAM_BOT_TOKEN,
      chatId,
      `👋 Welcome back!\n\n` +
        `Accent: <b>${accentLabel}</b>\n` +
        `Level:  <b>${levelLabel}</b>\n` +
        `Progress: <b>Day ${existing.current_day} of 30</b>\n\n` +
        `Send /today to get today's practice, or wait for your daily push.`,
    );
    return;
  }

  // Case 2: previously completed user — offer /restart.
  if (existing && existing.completed_at) {
    await sendMessage(
      env.TELEGRAM_BOT_TOKEN,
      chatId,
      `🎉 You've already completed a 30-day run.\n\n` +
        `Send /restart to begin a fresh 30-day run with a new accent or level.`,
    );
    return;
  }

  // Case 3: new user (or reset user) — enforce cap, then show accent picker.
  const capStr = await getConfig(env.DB, 'user_cap', env.DEFAULT_USER_CAP || '500');
  const cap = parseInt(capStr, 10);
  if (Number.isFinite(cap) && cap > 0) {
    const active = await countActiveUsers(env.DB);
    if (!existing && active >= cap) {
      await sendMessage(
        env.TELEGRAM_BOT_TOKEN,
        chatId,
        `😔 Sorry — all learner spots are currently full (${active}/${cap}).\n\n` +
          `Please check back later. We open new spots as learners finish their 30 days.`,
      );
      return;
    }
  }

  await upsertUserOnStart(env.DB, tgUser.id, tgUser.username || tgUser.first_name || null);
  await showAccentPicker(env, chatId);
}

// ---------------------------------------------------------------------------
// /restart handler — wipes progress and re-runs onboarding. We reset the
// existing row rather than deleting it, so we keep an audit of past runs
// (username, previous started_at will be overwritten on lock-in).
// ---------------------------------------------------------------------------
export async function handleRestart(env, chatId, tgUser) {
  const existing = await getUser(env.DB, tgUser.id);
  if (existing && existing.locked === 1 && existing.current_day <= 30) {
    await sendMessage(
      env.TELEGRAM_BOT_TOKEN,
      chatId,
      `🔒 You're still locked into your current run (Day ${existing.current_day} of 30). ` +
        `Finish your 30 days first — then /restart will work.`,
    );
    return;
  }

  // Fully clear their state so onboarding treats them as fresh.
  await env.DB
    .prepare(
      `UPDATE users
         SET accent_key = NULL,
             accent_prompt = NULL,
             level = NULL,
             current_day = 1,
             locked = 0,
             used_content_ids = '[]',
             today_content_id = NULL,
             started_at = NULL,
             completed_at = NULL
       WHERE telegram_id = ?`,
    )
    .bind(tgUser.id)
    .run();

  await showAccentPicker(env, chatId);
}

async function showAccentPicker(env, chatId) {
  const rows = [];
  const entries = Object.entries(ACCENTS);
  // 2 buttons per row.
  for (let i = 0; i < entries.length; i += 2) {
    const row = [];
    for (const [key, def] of entries.slice(i, i + 2)) {
      row.push({ text: def.label, callback_data: `accent:${key}` });
    }
    rows.push(row);
  }

  await sendMessage(
    env.TELEGRAM_BOT_TOKEN,
    chatId,
    `🎧 <b>Choose your target accent</b>\n\n` +
      `You'll hear a short fact or quote every day, spoken in this accent, ` +
      `for the next 30 days.`,
    inlineKeyboard(rows),
  );
}

async function showLevelPicker(env, chatId, messageId, accentKey) {
  const accent = ACCENTS[accentKey];
  const rows = [
    [
      { text: LEVELS.beginner.label,     callback_data: `level:${accentKey}:beginner` },
      { text: LEVELS.intermediate.label, callback_data: `level:${accentKey}:intermediate` },
    ],
    [
      { text: LEVELS.advanced.label,    callback_data: `level:${accentKey}:advanced` },
      { text: LEVELS.progressive.label, callback_data: `level:${accentKey}:progressive` },
    ],
  ];

  const body =
    `✅ Accent set: <b>${accent.label}</b>\n\n` +
    `📚 <b>Choose your difficulty level</b>\n\n` +
    `• <b>Beginner</b> — short, easy sentences\n` +
    `• <b>Intermediate</b> — medium sentences\n` +
    `• <b>Advanced</b> — richer vocabulary\n` +
    `• <b>Progressive</b> — starts easy and escalates over the 30 days`;

  await editMessageText(env.TELEGRAM_BOT_TOKEN, chatId, messageId, body, inlineKeyboard(rows));
}

// ---------------------------------------------------------------------------
// Callback query handlers for onboarding.
// data formats:
//   accent:<key>
//   level:<accentKey>:<levelKey>
// ---------------------------------------------------------------------------
export async function handleOnboardingCallback(env, cb) {
  const data = cb.data || '';
  const chatId = cb.message.chat.id;
  const messageId = cb.message.message_id;
  const tgUser = cb.from;

  if (data.startsWith('accent:')) {
    const accentKey = data.slice('accent:'.length);
    if (!ACCENTS[accentKey]) {
      await answerCallbackQuery(env.TELEGRAM_BOT_TOKEN, cb.id, 'Unknown accent.');
      return;
    }
    // Enforce cap again at this step (in case it changed between /start and pick).
    const existing = await getUser(env.DB, tgUser.id);
    if (!existing || existing.locked !== 1) {
      const capStr = await getConfig(env.DB, 'user_cap', env.DEFAULT_USER_CAP || '500');
      const cap = parseInt(capStr, 10);
      if (Number.isFinite(cap) && cap > 0) {
        const active = await countActiveUsers(env.DB);
        if (active >= cap) {
          await answerCallbackQuery(env.TELEGRAM_BOT_TOKEN, cb.id, 'All spots are full.', true);
          return;
        }
      }
    }
    await answerCallbackQuery(env.TELEGRAM_BOT_TOKEN, cb.id);
    await showLevelPicker(env, chatId, messageId, accentKey);
    return true;
  }

  if (data.startsWith('level:')) {
    const [, accentKey, levelKey] = data.split(':');
    if (!ACCENTS[accentKey] || !LEVELS[levelKey]) {
      await answerCallbackQuery(env.TELEGRAM_BOT_TOKEN, cb.id, 'Unknown selection.');
      return true;
    }
    // Final cap check.
    const existing = await getUser(env.DB, tgUser.id);
    if (!existing || existing.locked !== 1) {
      const capStr = await getConfig(env.DB, 'user_cap', env.DEFAULT_USER_CAP || '500');
      const cap = parseInt(capStr, 10);
      if (Number.isFinite(cap) && cap > 0) {
        const active = await countActiveUsers(env.DB);
        if (active >= cap) {
          await answerCallbackQuery(env.TELEGRAM_BOT_TOKEN, cb.id, 'All spots are full.', true);
          return true;
        }
      }
    }

    await lockInUser(
      env.DB,
      tgUser.id,
      accentKey,
      ACCENTS[accentKey].prompt,
      levelKey,
    );

    await answerCallbackQuery(env.TELEGRAM_BOT_TOKEN, cb.id, '🔒 Locked in!');
    await editMessageText(
      env.TELEGRAM_BOT_TOKEN,
      chatId,
      messageId,
      `🔒 <b>You're locked in for 30 days.</b>\n\n` +
        `Accent: <b>${ACCENTS[accentKey].label}</b>\n` +
        `Level:  <b>${LEVELS[levelKey].label}</b>\n\n` +
        `Your accent and level can't be changed until you finish.\n\n` +
        `➡️ Send /today anytime to get today's practice, or wait for your daily push.`,
    );
    return true;
  }

  return false;
}
