// src/channelGate.js
// Middleware: ensure the user has joined REQUIRED_CHANNEL before any
// command is honored. We re-check on every command (cheap API call, no
// caching), as specified.

import { getChatMember, sendMessage, inlineKeyboard } from './telegram.js';

// These statuses count as "joined the channel".
const MEMBER_STATUSES = new Set(['creator', 'administrator', 'member', 'restricted']);

export async function isChannelMember(env, telegramUserId) {
  const channel = env.REQUIRED_CHANNEL;
  if (!channel) return true; // no gate configured — let it through

  const res = await getChatMember(env.TELEGRAM_BOT_TOKEN, channel, telegramUserId);
  if (!res || !res.ok || !res.result) {
    // If the API call itself failed (e.g., bot isn't in the channel as admin,
    // wrong channel handle) we log and treat as NOT a member so the user gets
    // the gate message rather than silently letting them through.
    console.warn('getChatMember failed for', telegramUserId, res);
    return false;
  }
  const status = res.result.status; // creator | administrator | member | restricted | left | kicked
  return MEMBER_STATUSES.has(status);
}

export async function sendJoinGate(env, chatId) {
  const channel = env.REQUIRED_CHANNEL || '@your_channel';
  // Convert @handle -> t.me/handle URL for the inline button.
  const handle = channel.startsWith('@') ? channel.slice(1) : channel;
  const url = `https://t.me/${handle}`;

  const text =
    `👋 Welcome to <b>Accentura</b>!\n\n` +
    `To use this bot you first need to join our channel:\n${channel}\n\n` +
    `Tap the button below, then come back and send /start again.`;

  await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, text, inlineKeyboard([
    [{ text: `📣 Join ${channel}`, url }],
    [{ text: '✅ I have joined', callback_data: 'gate:recheck' }],
  ]));
}
