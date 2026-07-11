// src/index.js
// Entry point for the Cloudflare Worker.
//
// Two entry paths:
//   fetch()     — Telegram webhook + a couple of small operational routes
//   scheduled() — daily cron push
//
// Bindings expected on `env`:
//   env.DB                    -> D1 database (schema.sql)
//   env.TELEGRAM_BOT_TOKEN    -> secret
//   env.REQUIRED_CHANNEL      -> e.g. "@your_channel"
//   env.ADMIN_IDS             -> comma-separated Telegram user IDs
//   env.GEMINI_KEYS           -> JSON array of Gemini API keys, e.g. '["k1","k2"]'
//   env.GEMINI_KEY_1..100     -> optional individual key slots (fallback)
//   env.DEFAULT_USER_CAP      -> string, e.g. "500"

import { handleUpdate, deliverTodayItem } from './webhook.js';
import { listLockedUsers, advanceDay, markCompleted } from './db.js';
import { sendMessage } from './telegram.js';
import { ACCENTS } from './onboarding.js';

export default {
  // ---------------------------------------------------------------------------
  // HTTP handler: Telegram webhook + a couple of small ops endpoints.
  // ---------------------------------------------------------------------------
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Health-check
    if (request.method === 'GET' && url.pathname === '/') {
      return new Response('Accentura is running.', {
        headers: { 'content-type': 'text/plain' },
      });
    }

    // Telegram webhook.
    // Recommended: set the webhook to https://<your-worker>/webhook
    if (request.method === 'POST' && url.pathname === '/webhook') {
      let update;
      try {
        update = await request.json();
      } catch {
        return new Response('bad json', { status: 400 });
      }
      // Fire-and-forget so we always return 200 to Telegram promptly.
      ctx.waitUntil(handleUpdate(env, update));
      return new Response('ok');
    }

    // Manually trigger the daily job (admin diagnostic). Requires ?token=<TELEGRAM_BOT_TOKEN>
    // so it isn't publicly callable.
    if (request.method === 'POST' && url.pathname === '/run-cron') {
      const token = url.searchParams.get('token');
      if (!token || token !== env.TELEGRAM_BOT_TOKEN) {
        return new Response('forbidden', { status: 403 });
      }
      ctx.waitUntil(runDailyJob(env));
      return new Response('cron kicked off');
    }

    return new Response('not found', { status: 404 });
  },

  // ---------------------------------------------------------------------------
  // Cron handler (Triggers > Cron Triggers)
  // ---------------------------------------------------------------------------
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runDailyJob(env));
  },
};

// -----------------------------------------------------------------------------
// Daily push job — send today's item to every locked user, then advance
// their day counter. If a user reaches day 30, mark them completed.
// -----------------------------------------------------------------------------
async function runDailyJob(env) {
  const startedAt = Date.now();
  let users = [];
  try {
    users = await listLockedUsers(env.DB);
  } catch (err) {
    console.error('Cron: failed to list locked users:', err);
    return;
  }

  console.log(`Cron: processing ${users.length} locked users`);

  for (const user of users) {
    try {
      // Deliver today's item (this also sets today_content_id if not already set).
      await deliverTodayItem(env, user, user.telegram_id, /* isManual */ false);

      // Advance day counter. If we've just delivered day 30, finish.
      if (user.current_day >= 30) {
        await markCompleted(env.DB, user.telegram_id);
        const accentLabel = ACCENTS[user.accent_key]?.label || user.accent_key;
        await sendMessage(
          env.TELEGRAM_BOT_TOKEN,
          user.telegram_id,
          `🎉 <b>Congratulations!</b>\n\n` +
            `You've completed your 30-day Accentura run with the ${accentLabel} accent.\n\n` +
            `Send /restart anytime to begin a fresh run with a new accent or level.`,
        );
      } else {
        await advanceDay(env.DB, user.telegram_id, user.current_day + 1);
      }
    } catch (err) {
      console.error(
        `Cron: failed for user ${user.telegram_id}:`,
        err && err.stack ? err.stack : err,
      );
      // Don't rethrow — keep processing the rest of the users.
    }
    // Small pacing delay to be nice to Telegram's rate limits.
    await new Promise((r) => setTimeout(r, 60));
  }

  console.log(`Cron: done in ${Date.now() - startedAt}ms`);
}
