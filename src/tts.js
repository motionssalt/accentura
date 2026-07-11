// src/tts.js
// Gemini TTS wrapper with round-robin API key rotation and per-key
// cooldown on rate-limit / auth errors.
//
// Endpoint used (stable, generally-available REST surface):
//   POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent
//   with responseModalities: ["AUDIO"] and a speechConfig.voiceConfig.
//
// The response contains an inline audio blob: base64 PCM 16-bit little-endian,
// 24 kHz mono (mimeType: audio/L16;codec=pcm;rate=24000). We wrap that PCM
// into a WAV container in-memory so Telegram can play it directly.

import { getConfig, setConfig, getKeyStatuses, setKeyCooldown, clearKeyCooldown } from './db.js';

const MODEL   = 'gemini-2.5-flash-preview-tts';
const VOICE   = 'Kore'; // firm, clear — accent variation comes from the prompt string
const RATE    = 24000;
const COOLDOWN_MS = 10 * 60 * 1000; // 10 minutes on 429/401/403

// -----------------------------------------------------------------------------
// Public entry point.
// Returns { ok: true, wavBytes: Uint8Array } on success,
// or { ok: false, reason: 'no_keys' | 'all_failed', lastError?: string }.
// -----------------------------------------------------------------------------
export async function synthesize(env, accentPrompt, text) {
  const keys = loadKeys(env);
  if (keys.length === 0) {
    console.error('No Gemini API keys configured.');
    return { ok: false, reason: 'no_keys' };
  }

  const cooldowns = await getKeyStatuses(env.DB);
  const now = Date.now();

  // Round-robin starting index.
  const startIdxStr = await getConfig(env.DB, 'active_key_index', '0');
  let startIdx = parseInt(startIdxStr, 10);
  if (!Number.isFinite(startIdx) || startIdx < 0) startIdx = 0;
  startIdx = startIdx % keys.length;

  const promptText = `${accentPrompt}\n\n${text}`;
  let lastError = null;
  let attemptedKeys = 0;

  for (let step = 0; step < keys.length; step++) {
    const idx = (startIdx + step) % keys.length;
    const key = keys[idx];
    if (!key) continue; // empty slot — skip silently

    // Skip keys still in cooldown.
    const cooldownUntil = cooldowns.get(idx);
    if (cooldownUntil && Date.parse(cooldownUntil) > now) {
      continue;
    }

    attemptedKeys++;
    try {
      const wavBytes = await callGeminiTTS(key, promptText);
      // Success — advance the round-robin index and clear any cooldown.
      await setConfig(env.DB, 'active_key_index', String((idx + 1) % keys.length));
      if (cooldownUntil) await clearKeyCooldown(env.DB, idx);
      return { ok: true, wavBytes, keyIndex: idx };
    } catch (err) {
      lastError = err;
      console.warn(`Gemini key #${idx} failed:`, err && err.message ? err.message : err);
      const status = err && err.status;
      if (status === 429 || status === 401 || status === 403) {
        const until = new Date(Date.now() + COOLDOWN_MS).toISOString();
        await setKeyCooldown(env.DB, idx, until);
      }
      // continue to next key
    }
  }

  if (attemptedKeys === 0) {
    console.error('All Gemini keys are in cooldown or missing.');
  }
  return { ok: false, reason: 'all_failed', lastError: String(lastError || 'unknown') };
}

// -----------------------------------------------------------------------------
// Key loading: prefer GEMINI_KEYS (JSON array). Fall back to
// GEMINI_KEY_1 ... GEMINI_KEY_100 individual slots.
// -----------------------------------------------------------------------------
function loadKeys(env) {
  const arr = [];

  if (env.GEMINI_KEYS) {
    try {
      const parsed = JSON.parse(env.GEMINI_KEYS);
      if (Array.isArray(parsed)) {
        for (const k of parsed) arr.push(typeof k === 'string' ? k.trim() : '');
      }
    } catch (e) {
      console.warn('GEMINI_KEYS is not valid JSON, falling back to numbered vars.');
    }
  }

  if (arr.length === 0) {
    for (let i = 1; i <= 100; i++) {
      const v = env[`GEMINI_KEY_${i}`];
      if (typeof v === 'string' && v.trim().length > 0) arr.push(v.trim());
      else arr.push(''); // keep slot to preserve stable indices
    }
  }

  // Trim trailing empties so we don't loop over 100 blanks every time.
  while (arr.length > 0 && !arr[arr.length - 1]) arr.pop();
  return arr;
}

// -----------------------------------------------------------------------------
// Single Gemini call. Throws Error with .status on HTTP errors.
// -----------------------------------------------------------------------------
async function callGeminiTTS(apiKey, promptText) {
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent` +
    `?key=${encodeURIComponent(apiKey)}`;

  const body = {
    contents: [{ parts: [{ text: promptText }] }],
    generationConfig: {
      responseModalities: ['AUDIO'],
      speechConfig: {
        voiceConfig: { prebuiltVoiceConfig: { voiceName: VOICE } },
      },
    },
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    const err = new Error(`Gemini HTTP ${res.status}: ${errText.slice(0, 300)}`);
    err.status = res.status;
    throw err;
  }

  const data = await res.json();
  const part = data?.candidates?.[0]?.content?.parts?.[0];
  const inline = part?.inlineData || part?.inline_data;
  if (!inline || !inline.data) {
    throw new Error('Gemini response missing inline audio data: ' + JSON.stringify(data).slice(0, 300));
  }

  // Decode base64 -> PCM bytes.
  const pcm = base64ToUint8Array(inline.data);

  // Parse rate from mimeType if provided (e.g. "audio/L16;codec=pcm;rate=24000").
  let rate = RATE;
  const mt = inline.mimeType || inline.mime_type || '';
  const m = /rate=(\d+)/i.exec(mt);
  if (m) rate = parseInt(m[1], 10) || RATE;

  return pcmToWav(pcm, rate, 1, 16);
}

// -----------------------------------------------------------------------------
// Utility: base64 -> Uint8Array (Workers-safe, no Buffer required).
// -----------------------------------------------------------------------------
function base64ToUint8Array(b64) {
  const binStr = atob(b64);
  const len = binStr.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = binStr.charCodeAt(i);
  return bytes;
}

// -----------------------------------------------------------------------------
// Utility: wrap raw PCM in a WAV (RIFF) container.
// -----------------------------------------------------------------------------
function pcmToWav(pcm, sampleRate, numChannels, bitsPerSample) {
  const byteRate   = (sampleRate * numChannels * bitsPerSample) / 8;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const dataSize   = pcm.byteLength;
  const buffer     = new ArrayBuffer(44 + dataSize);
  const view       = new DataView(buffer);

  // RIFF header
  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(view, 8, 'WAVE');
  // fmt sub-chunk
  writeAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true);        // PCM chunk size
  view.setUint16(20, 1, true);         // PCM format
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  // data sub-chunk
  writeAscii(view, 36, 'data');
  view.setUint32(40, dataSize, true);

  new Uint8Array(buffer, 44).set(pcm);
  return new Uint8Array(buffer);
}

function writeAscii(view, offset, str) {
  for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
}
