# Accentura — Changelog for this patch

All files below are in this zip at the exact path they belong at in the repo.
Drop them straight in over the existing tree (no other files touched).

---

## Files added

- **`schema-migration.sql`** *(NEW)* — one-shot
  `ALTER TABLE users ADD COLUMN today_audio_file_id TEXT;`
  Required for existing deployed D1 databases so the users table gains the
  new cache column without dropping data. Safe to re-run (SQLite will error
  with "duplicate column name" if already applied — harmless).
- **`assets/README.md`** *(NEW)* — placeholder / instructions in the new
  `assets/` folder telling you exactly what image to drop where. The folder
  must exist for the `[assets]` binding in `wrangler.toml` to be valid on
  first deploy. **You still need to drop your actual image at
  `assets/accentura-cover.jpg`** (JPEG, ≤200 kB, ≤320×320 px). A `.png` at
  `assets/accentura-cover.png` works as a fallback.

## Files modified

- **`src/telegram.js`** — `sendAudio` now:
  - accepts an `extra` options object with `performer`, `title`, `thumbnail`,
    `thumbnailMime`, `thumbnailFilename`, `mimeType`, `reply_markup`;
  - **supports two audio modes** — pass a `Uint8Array` to upload fresh bytes
    OR pass a `string` to resend by Telegram `file_id` (skips re-upload
    entirely, per Telegram Bot API);
  - attaches the thumbnail via a separate multipart part (Telegram requires
    it uploaded each time — `file_id` reuse of thumbnails is not allowed);
  - still returns the raw Telegram response so callers can pluck
    `result.audio.file_id` for caching.
- **`src/db.js`**
  - New helper **`setTodayAudioFileId(db, telegramId, fileId)`** — persists
    (or clears) the cached audio file_id for a user.
  - **`lockInUser`** now also resets `today_audio_file_id = NULL` on lock-in
    (fresh run must not inherit stale audio).
  - **`advanceDay`** now clears BOTH `today_content_id` AND
    `today_audio_file_id` when the cron rolls the user forward, so the
    next day always regenerates fresh content + audio.
- **`src/webhook.js`**
  - `deliverTodayItem` rewritten to a two-path model:
    - **Fast path**: if `user.today_audio_file_id` is set, resend by
      `file_id` via `sendAudio` — **no Gemini call, no re-upload**. Falls
      through to the slow path if the resend fails (rare — expired file_id).
    - **Slow path**: call `synthesize`, upload via `sendAudio`, then
      persist the returned `file_id` via `setTodayAudioFileId`.
  - Every audio send (both paths) now carries:
    - `performer = "Erastan"` (hardcoded constant — no fallback, appears on
      every single clip);
    - `title = "Accentura — Day {N} ({accent label})"` (auto-generated per
      clip via `buildAudioTitle`, e.g. `"Accentura — Day 7 (🇬🇧 British RP)"`);
    - `thumbnail = <bytes of assets/accentura-cover.jpg or .png>` loaded via
      `env.ASSETS.fetch(...)`. If neither file is present, delivery
      continues without a thumbnail — a missing cover MUST NOT block users.
  - **New `/settings` command** (`handleSettings` + `renderSettings`):
    - Locked users: read-only info panel (accent, level, day X of 30, days
      remaining) with inline buttons `[📈 View streak]`,
      `[🎧 Get today's audio]`, `[🔄 Refresh]`.
    - Completed users: inline buttons `[🔁 Restart with new accent]` +
      `[📊 View stats]` — both fully actionable.
    - Pre-onboarding users: nudge + `[🚀 Start onboarding]` button.
  - **New callback-query dispatcher `handleSettingsCallback`** — handles
    `settings:start`, `settings:refresh`, `settings:streak`, `settings:today`,
    `settings:restart`, `settings:stats`. Structurally consistent with the
    existing `handleOnboardingCallback` (single entry, prefix-parsed data,
    uses `answerCallbackQuery` + `editMessageText`/`sendMessage`) — no
    second inconsistent callback pattern introduced.
  - Router in `handleMessage` gains `case '/settings'`.
  - `/help` output updated to list `/settings`.
- **`src/onboarding.js`**
  - `/start` for **already-locked returning users** now sends the welcome
    message with inline buttons `[🎧 Get today's audio]` + `[⚙️ Settings]`
    (previously plain text only — spec: "make sure inline buttons are
    present, not only plain text").
  - `/start` for **completed users** now offers inline buttons
    `[🔁 Restart with new accent]` + `[📊 View stats]`.
  - The **lock-in confirmation** screen at the end of onboarding also gets
    the same `[🎧 Get today's audio]` + `[⚙️ Settings]` buttons.
  - `handleRestart` now also clears `today_audio_file_id` in its wipe
    (matches the fresh-user semantics of `lockInUser`).
- **`schema.sql`** — `users` table now declares `today_audio_file_id TEXT`.
  For **fresh deployments only**. Existing deployments must use
  `schema-migration.sql` (SQLite doesn't add columns via a re-run of
  `CREATE TABLE IF NOT EXISTS`).
- **`wrangler.toml`** — new `[assets] directory = "./assets" binding = "ASSETS"`
  block, exposing the `assets/` folder to the Worker as `env.ASSETS.fetch(...)`.
  Everything else (D1 binding, cron trigger, vars) is unchanged.
- **`README.md`** — feature list mentions:
  - branded audio delivery (Erastan performer, per-day title, cover art);
  - once-per-day TTS with Telegram file_id caching;
  - `/settings` command;
  - `assets/accentura-cover.jpg` — YOU MUST DROP THIS FILE;
  - `schema-migration.sql` step for existing deployments.
- **`setup.md`** — expanded with:
  - new **step 2.5** — run `schema-migration.sql` on existing deployments;
  - new **step 4b** — drop the cover image at `assets/accentura-cover.jpg`
    (JPEG, ≤200 kB, ≤320×320 px);
  - **step 6** — mention of the `ASSETS` binding alongside the `DB` binding;
  - **step 10** — `/settings` listed for regular users; `/today` blurb updated
    to explain the same-day cache;
  - **step 11** — new troubleshooting entries: "Audio comes through with no
    album art", "Audio doesn't show Erastan", "D1 error: no such column
    today_audio_file_id", and "Force-regenerate today's audio for a specific
    user";
  - **section 12** — updated `/restart` explainer to mention the
    `today_audio_file_id` clear.

## Files intentionally NOT touched

- `src/index.js`, `src/tts.js`, `src/content.js`, `src/admin.js`,
  `src/channelGate.js`, `package.json`, `content-seed.sql` — none required
  changes. In particular, `src/index.js`'s cron loop still calls
  `advanceDay(...)`, which now also clears `today_audio_file_id`; no change
  to `index.js` itself was needed.

---

## Action items after dropping these files in

1. **Existing deployment only:** paste `schema-migration.sql` into the D1
   console and Execute. (Fresh deployment: paste `schema.sql`.)
2. **Drop your image** at `assets/accentura-cover.jpg` (or `.png`) — JPEG
   ≤200 kB, ≤320×320 px. Without this, audio still goes out (with performer
   + title) but without a thumbnail.
3. Redeploy (Cloudflare auto-redeploys on push if you're using the
   dashboard-connected GitHub flow).
4. Verify by sending `/today` twice in a row from a locked test user:
   - **First call**: should hit Gemini (visible in Worker logs).
   - **Second call, same day**: should skip Gemini entirely and resend
     instantly. Both clips should display "Erastan" as performer,
     "Accentura — Day N (accent)" as title, and your cover art.
5. Send `/settings` — you should see the inline-button panel appropriate to
   your current lock/completion state.

---

## Audio title scheme (documented per spec)

Titles are auto-generated as:

    Accentura — Day {N} ({accent label})

Examples:

- `Accentura — Day 1 (🇬🇧 British RP)`
- `Accentura — Day 12 (🇦🇺 Australian)`
- `Accentura — Day 30 (🇺🇸 American (General))`

The generator lives in `buildAudioTitle(day, accentLabel)` in `src/webhook.js`.
It never returns "Untitled" or a generic placeholder — the accent label
always resolves via `ACCENTS[user.accent_key]?.label || user.accent_key`, and
the day is always the integer `user.current_day`, so both fields always
produce meaningful output.
