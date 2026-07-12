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

// -----------------------------------------------------------------------------
// sendAudio — supports BOTH first-upload (Uint8Array bytes) and resend-by-file_id
// (string). Also supports performer / title / thumbnail so the audio shows up
// in Telegram clients with proper artist + title + album-art in the music
// player UI.
//
// Params (object form):
//   token        — bot token
//   chatId       — target chat id
//   audio        — Uint8Array (bytes to upload) OR string (Telegram file_id)
//   filename     — required only when audio is bytes (e.g. "accentura_day3.wav")
//   mimeType     — MIME type for byte uploads (default "audio/wav")
//   caption      — HTML caption text (optional)
//   performer    — ID3-style performer / artist string shown in Telegram's player
//   title        — ID3-style title string shown in Telegram's player
//   thumbnail    — Uint8Array of JPEG bytes to attach as album-art (optional).
//                  Telegram requires JPEG, <=200 kB, up to 320x320 px.
//                  Note: per Bot API, thumbnails cannot be reused by file_id
//                  and must be uploaded as attach:// each time.
//
// Returns the raw Telegram response object. On success, response.result.audio
// exposes the audio's file_id which callers can persist for reuse.
// -----------------------------------------------------------------------------
export async function sendAudio(
  token,
  chatId,
  audio,
  filename,
  caption,
  extra = {},
) {
  const form = new FormData();
  form.append('chat_id', String(chatId));
  if (caption) {
    form.append('caption', caption);
    form.append('parse_mode', 'HTML');
  }

  // performer/title carry the branded metadata (Erastan / daily title).
  if (extra.performer) form.append('performer', String(extra.performer));
  if (extra.title)     form.append('title',     String(extra.title));

  // audio can be either a Uint8Array (fresh upload) or a string (file_id reuse).
  if (typeof audio === 'string') {
    // Resend by file_id — no upload, no filename needed.
    form.append('audio', audio);
  } else {
    const mimeType = extra.mimeType || 'audio/wav';
    const blob = new Blob([audio], { type: mimeType });
    form.append('audio', blob, filename || 'accentura.wav');
  }

  // Optional thumbnail (album art). Must be JPEG <=200KB, <=320x320.
  // Uploaded via attach:// so Telegram associates it with this send call.
  if (extra.thumbnail && extra.thumbnail.byteLength > 0) {
    const thumbBlob = new Blob([extra.thumbnail], {
      type: extra.thumbnailMime || 'image/jpeg',
    });
    form.append('thumbnail', thumbBlob, extra.thumbnailFilename || 'cover.jpg');
  }

  if (extra.reply_markup) {
    form.append('reply_markup', JSON.stringify(extra.reply_markup));
  }

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
