// src/telegram.js
// Thin wrapper around the Telegram Bot API.
// All functions accept a `token` (env.TELEGRAM_BOT_TOKEN) as first arg.

const TG = (token, method) => `https://api.telegram.org/bot${token}/${method}`;

async function tgCall(token, method, payload) {
  const res = await fetch(TG(token, method), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!data.ok) {
    console.error(`Telegram ${method} failed:`, data);
  }
  return data;
}

export function sendMessage(token, chatId, text, opts = {}) {
  return tgCall(token, 'sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    ...opts,
  });
}

export function editMessageText(token, chatId, messageId, text, opts = {}) {
  return tgCall(token, 'editMessageText', {
    chat_id: chatId,
    message_id: messageId,
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    ...opts,
  });
}

export function answerCallbackQuery(token, callbackQueryId, text = '', showAlert = false) {
  return tgCall(token, 'answerCallbackQuery', {
    callback_query_id: callbackQueryId,
    text,
    show_alert: showAlert,
  });
}

// getChatMember — returns member status for the channel gate.
export async function getChatMember(token, chatId, userId) {
  const url = TG(token, 'getChatMember') +
    `?chat_id=${encodeURIComponent(chatId)}&user_id=${encodeURIComponent(userId)}`;
  const res = await fetch(url);
  return res.json().catch(() => ({ ok: false }));
}

// sendAudio via multipart/form-data. `audioBytes` is a Uint8Array (WAV).
// We use sendAudio (not sendVoice) because Telegram's sendVoice requires
// OGG/Opus, which we can't encode inside a Cloudflare Worker. sendAudio
// with a WAV plays inline in every Telegram client and satisfies the
// "voice note plus caption" UX described in the spec.
export async function sendAudio(token, chatId, audioBytes, filename, caption) {
  const form = new FormData();
  form.append('chat_id', String(chatId));
  if (caption) {
    form.append('caption', caption);
    form.append('parse_mode', 'HTML');
  }
  const blob = new Blob([audioBytes], { type: 'audio/wav' });
  form.append('audio', blob, filename || 'accentura.wav');

  const res = await fetch(TG(token, 'sendAudio'), { method: 'POST', body: form });
  const data = await res.json().catch(() => ({}));
  if (!data.ok) {
    console.error('Telegram sendAudio failed:', data);
  }
  return data;
}

// Convenience: build an inline keyboard from a 2D array of {text, callback_data}
// or {text, url}.
export function inlineKeyboard(rows) {
  return { reply_markup: { inline_keyboard: rows } };
}
