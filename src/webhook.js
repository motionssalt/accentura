// src/webhook.js
// Telegram update handler & command router.

import {
  sendMessage,
  sendAudio,
  answerCallbackQuery,
  editMessageText,
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
import { getUser, setTodayContent, setTodayAudioFileId } from './db.js';
import { pickContentForUser } from './content.js';
import { synthesize } from './tts.js';
import {
  isAdmin,
  handleSetCap,
  handleStats,
  handleBroadcast,
} from './admin.js';

// -----------------------------------------------------------------------------
// Branding constants for audio delivery.
// PERFORMER is fixed per spec — must appear on every clip.
// Cover art is looked up from the ASSETS binding (see wrangler.toml).
// -----------------------------------------------------------------------------
const PERFORMER = 'Erastan';
// Order matters: first hit wins. Users may drop either .jpg or .png.
const COVER_ASSET_CANDIDATES = [
  '/assets/accentura-cover.jpg',
  '/assets/accentura-cover.jpeg',
  '/assets/accentura-cover.png',
];

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

    case '/settings':
      await handleSettings(env, chatId, from);
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
      `/settings — view your run info & options\n` +
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
// /settings — persistent, always-available status + actions.
// While locked: read-only info panel with inline buttons for viewing only.
// After completion: actionable "Restart" + "View stats" buttons.
// Pre-onboarding: nudge to /start.
// -----------------------------------------------------------------------------
async function handleSettings(env, chatId, tgUser) {
  const user = await getUser(env.DB, tgUser.id);
  if (!user || !user.accent_key) {
    await sendMessage(
      env.TELEGRAM_BOT_TOKEN,
      chatId,
      `⚙️ <b>Settings</b>\n\n` +
        `You haven't started yet. Send /start to pick an accent and level.`,
      inlineKeyboard([[{ text: '🚀 Start onboarding', callback_data: 'settings:start' }]]),
    );
    return;
  }
  await renderSettings(env, chatId, user, /* messageId */ null);
}

// Renders the /settings body. If messageId is provided the existing message
// is edited in place (used by inline-button refresh flows); otherwise a new
// message is sent.
async function renderSettings(env, chatId, user, messageId) {
  const accentLabel = ACCENTS[user.accent_key]?.label || user.accent_key;
  const levelLabel  = LEVELS[user.level]?.label      || user.level;
  const isLocked    = user.locked === 1 && user.current_day <= 30;
  const isCompleted = !!user.completed_at || user.current_day > 30;

  let body;
  let keyboard;

  if (isLocked) {
    const daysRemaining = Math.max(0, 30 - user.current_day + 1); // includes today
    body =
      `⚙️ <b>Settings</b>\n\n` +
      `Accent: <b>${accentLabel}</b>\n` +
      `Level:  <b>${levelLabel}</b>\n` +
      `Progress: <b>Day ${user.current_day} of 30</b>\n` +
      `Days remaining: <b>${daysRemaining}</b>\n\n` +
      `🔒 These can't be changed until you finish all 30 days.\n` +
      `Finish the run, then /restart unlocks a new accent / level.`;
    keyboard = inlineKeyboard([
      [{ text: '📈 View streak',   callback_data: 'settings:streak'   }],
      [{ text: `🎧 Get today's audio`, callback_data: 'settings:today' }],
      [{ text: '🔄 Refresh',       callback_data: 'settings:refresh'  }],
    ]);
  } else if (isCompleted) {
    body =
      `⚙️ <b>Settings</b>\n\n` +
      `🎉 You've completed a 30-day run.\n\n` +
      `Last accent: <b>${accentLabel}</b>\n` +
      `Last level:  <b>${levelLabel}</b>`;
    keyboard = inlineKeyboard([
      [{ text: '🔁 Restart with new accent', callback_data: 'settings:restart' }],
      [{ text: '📊 View stats',              callback_data: 'settings:stats'   }],
    ]);
  } else {
    // Row exists but user is between runs (e.g. after /restart before pick).
    body =
      `⚙️ <b>Settings</b>\n\n` +
      `You're between runs. Send /start to begin a new one.`;
    keyboard = inlineKeyboard([
      [{ text: '🚀 Start onboarding', callback_data: 'settings:start' }],
    ]);
  }

  if (messageId) {
    await editMessageText(env.TELEGRAM_BOT_TOKEN, chatId, messageId, body, keyboard);
  } else {
    await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, body, keyboard);
  }
}

// -----------------------------------------------------------------------------
// /today — fetch (or reuse) today's item, synthesize (or reuse cached audio),
// and send as audio + caption. Does NOT increment current_day (only cron does).
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

// -----------------------------------------------------------------------------
// Shared delivery routine used by /today AND by the scheduled cron.
//
// Caching contract:
//   - If user.today_audio_file_id is set for the current day, we skip Gemini
//     entirely and resend the cached file_id via sendAudio.
//   - If it isn't set, we generate via Gemini, send once, then persist the
//     returned file_id so subsequent same-day calls reuse it.
//   - The advanceDay() helper clears today_audio_file_id (and
//     today_content_id) when the cron rolls the user forward, guaranteeing
//     the next day generates fresh content + audio.
// -----------------------------------------------------------------------------
export async function deliverTodayItem(env, user, chatId, isManual) {
  // Reuse today's cached content pick if it exists; otherwise select fresh.
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

  // Build branded metadata for this clip.
  const accentLabel = ACCENTS[user.accent_key]?.label || user.accent_key;
  const audioTitle  = buildAudioTitle(user.current_day, accentLabel);
  const typeLabel   = contentItem.type === 'quote' ? '💬 Quote' : '💡 Fact';
  const caption =
    `<b>Day ${user.current_day} of 30 · ${accentLabel}</b>\n` +
    `${typeLabel}\n\n` +
    escapeHtml(contentItem.text);

  const thumbnail = await loadCoverArt(env);
  const audioExtras = {
    performer:         PERFORMER,
    title:             audioTitle,
    thumbnail:         thumbnail?.bytes,
    thumbnailMime:     thumbnail?.mime,
    thumbnailFilename: thumbnail?.filename,
  };

  // -------------------- FAST PATH: cached file_id --------------------
  if (user.today_audio_file_id) {
    const resend = await sendAudio(
      env.TELEGRAM_BOT_TOKEN,
      chatId,
      user.today_audio_file_id, // string -> Telegram treats as file_id
      null,                      // filename ignored for file_id sends
      caption,
      audioExtras,
    );
    if (resend && resend.ok) {
      return;
    }
    // If the cached file_id was rejected (very rare — file expired, etc.),
    // fall through to regenerate + re-cache.
    console.warn(
      `Cached file_id resend failed for user ${user.telegram_id}, regenerating.`,
      resend && resend.description,
    );
  }

  // -------------------- SLOW PATH: synthesize + upload --------------------
  const tts = await synthesize(env, user.accent_prompt, contentItem.text);
  if (!tts.ok) {
    await sendMessage(
      env.TELEGRAM_BOT_TOKEN,
      chatId,
      `🔊 Audio generation is temporarily unavailable. Please try /today again in a few minutes.`,
    );
    return;
  }

  const upload = await sendAudio(
    env.TELEGRAM_BOT_TOKEN,
    chatId,
    tts.wavBytes,
    `accentura_day${user.current_day}.wav`,
    caption,
    { ...audioExtras, mimeType: 'audio/wav' },
  );

  // Persist the newly-uploaded file_id so subsequent same-day calls are
  // free (no Gemini hit, no re-upload). Telegram's `audio.file_id` on the
  // response identifies the reusable audio object.
  const fileId = upload?.result?.audio?.file_id;
  if (fileId) {
    try {
      await setTodayAudioFileId(env.DB, user.telegram_id, fileId);
    } catch (err) {
      console.warn('Failed to persist today_audio_file_id:', err);
    }
  }

  if (isManual) {
    // Manual /today shouldn't advance the day; that's the cron's job.
  }
}

// -----------------------------------------------------------------------------
// Auto-generated title scheme:
//   "Accentura — Day {N} ({accent label})"
// e.g. "Accentura — Day 7 (🇬🇧 British RP)"
// -----------------------------------------------------------------------------
function buildAudioTitle(day, accentLabel) {
  const safeLabel = String(accentLabel || '').trim() || 'Accent';
  return `Accentura — Day ${day} (${safeLabel})`;
}

// -----------------------------------------------------------------------------
// Load the bot's cover art from the ASSETS binding. Tries .jpg then .png.
// Returns { bytes, mime, filename } or null if none of the candidate files
// exist. All errors are swallowed — a missing cover MUST NOT block delivery.
// -----------------------------------------------------------------------------
async function loadCoverArt(env) {
  if (!env.ASSETS || typeof env.ASSETS.fetch !== 'function') return null;
  for (const path of COVER_ASSET_CANDIDATES) {
    try {
      const res = await env.ASSETS.fetch(new Request('https://assets.internal' + path));
      if (!res.ok) continue;
      const buf = await res.arrayBuffer();
      if (!buf || buf.byteLength === 0) continue;
      const isPng = path.endsWith('.png');
      return {
        bytes:    new Uint8Array(buf),
        mime:     isPng ? 'image/png' : 'image/jpeg',
        filename: path.split('/').pop(),
      };
    } catch (err) {
      // Try next candidate.
    }
  }
  return null;
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

  // Settings callbacks (data prefix "settings:").
  if (data.startsWith('settings:')) {
    await handleSettingsCallback(env, cb);
    return;
  }

  // Onboarding callbacks: accent:<key> and level:<accent>:<level>
  const handled = await handleOnboardingCallback(env, cb);
  if (handled) return;

  // Unknown callback data.
  await answerCallbackQuery(env.TELEGRAM_BOT_TOKEN, cb.id);
}

// -----------------------------------------------------------------------------
// /settings inline-button dispatcher. Kept structurally consistent with
// handleOnboardingCallback: single entry, prefix-parsed data, uses
// answerCallbackQuery + editMessageText / sendMessage as needed.
// -----------------------------------------------------------------------------
async function handleSettingsCallback(env, cb) {
  const action = (cb.data || '').slice('settings:'.length);
  const chatId = cb.message.chat.id;
  const messageId = cb.message.message_id;
  const tgUser = cb.from;
  const user = await getUser(env.DB, tgUser.id);

  switch (action) {
    case 'start': {
      await answerCallbackQuery(env.TELEGRAM_BOT_TOKEN, cb.id);
      await handleStart(env, chatId, tgUser);
      return;
    }

    case 'refresh': {
      if (!user || !user.accent_key) {
        await answerCallbackQuery(env.TELEGRAM_BOT_TOKEN, cb.id);
        return;
      }
      await answerCallbackQuery(env.TELEGRAM_BOT_TOKEN, cb.id, 'Refreshed');
      await renderSettings(env, chatId, user, messageId);
      return;
    }

    case 'streak': {
      if (!user || !user.accent_key) {
        await answerCallbackQuery(env.TELEGRAM_BOT_TOKEN, cb.id);
        return;
      }
      await answerCallbackQuery(env.TELEGRAM_BOT_TOKEN, cb.id);
      const accentLabel = ACCENTS[user.accent_key]?.label || user.accent_key;
      const startedAt = user.started_at
        ? new Date(user.started_at).toISOString().slice(0, 10)
        : '—';
      const done = Math.max(0, (user.current_day || 1) - 1);
      const remaining = Math.max(0, 30 - (user.current_day || 1) + 1);
      const bar = renderProgressBar(user.current_day || 1);
      await sendMessage(
        env.TELEGRAM_BOT_TOKEN,
        chatId,
        `📈 <b>Your streak</b>\n\n` +
          `Accent: <b>${accentLabel}</b>\n` +
          `Started: <b>${startedAt}</b>\n` +
          `Days delivered: <b>${done}</b>\n` +
          `Days remaining: <b>${remaining}</b>\n\n` +
          `${bar}`,
      );
      return;
    }

    case 'today': {
      await answerCallbackQuery(env.TELEGRAM_BOT_TOKEN, cb.id, 'Fetching…');
      await handleToday(env, chatId, tgUser);
      return;
    }

    case 'restart': {
      if (!user || user.locked === 1) {
        await answerCallbackQuery(
          env.TELEGRAM_BOT_TOKEN,
          cb.id,
          `You can restart only after completing a run.`,
          true,
        );
        return;
      }
      await answerCallbackQuery(env.TELEGRAM_BOT_TOKEN, cb.id);
      await handleRestart(env, chatId, tgUser);
      return;
    }

    case 'stats': {
      if (!user || !user.accent_key) {
        await answerCallbackQuery(env.TELEGRAM_BOT_TOKEN, cb.id);
        return;
      }
      await answerCallbackQuery(env.TELEGRAM_BOT_TOKEN, cb.id);
      const accentLabel = ACCENTS[user.accent_key]?.label || user.accent_key;
      const levelLabel  = LEVELS[user.level]?.label      || user.level;
      const startedAt = user.started_at
        ? new Date(user.started_at).toISOString().slice(0, 10)
        : '—';
      const completedAt = user.completed_at
        ? new Date(user.completed_at).toISOString().slice(0, 10)
        : '—';
      const daysDone = user.completed_at ? 30 : Math.max(0, (user.current_day || 1) - 1);
      await sendMessage(
        env.TELEGRAM_BOT_TOKEN,
        chatId,
        `📊 <b>Your stats</b>\n\n` +
          `Accent: <b>${accentLabel}</b>\n` +
          `Level:  <b>${levelLabel}</b>\n` +
          `Days completed: <b>${daysDone} / 30</b>\n` +
          `Started:   <b>${startedAt}</b>\n` +
          `Completed: <b>${completedAt}</b>`,
      );
      return;
    }

    default:
      await answerCallbackQuery(env.TELEGRAM_BOT_TOKEN, cb.id);
  }
}

// Simple text progress bar for the streak view. 10 cells covering 30 days.
function renderProgressBar(currentDay) {
  const total = 30;
  const cells = 10;
  const done = Math.max(0, Math.min(total, currentDay - 1));
  const filled = Math.round((done / total) * cells);
  return `[${'█'.repeat(filled)}${'░'.repeat(cells - filled)}] Day ${currentDay}/${total}`;
}
