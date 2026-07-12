# Accentura

A Telegram bot that helps you learn a target English accent by sending one
short **fact or quote per day, spoken by Gemini TTS in your chosen accent**,
for 30 days.

- 🎧 6 accents: British RP, Scottish, Irish, Australian, American General, South African
- 📚 4 difficulty levels: Beginner / Intermediate / Advanced / Progressive
- 🔒 30-day locked run — no accent/level swapping mid-run
- ⏰ Daily push via Cloudflare Cron; `/today` for on-demand
- 🎨 Branded audio delivery — every clip carries the **Erastan** performer tag,
  a per-day title, and the bot's album-art thumbnail (from `/assets/`)
- ♻️ Once-per-day TTS — the day's clip is generated once and cached by
  Telegram `file_id`, so repeat `/today` calls are instant and free
- ⚙️ `/settings` — inline-button panel showing progress, streak, and
  post-completion actions (restart, view stats)
- 🔑 Up to 100 Gemini API keys with round-robin + cooldown failover
- 🚪 Channel gate — users must join your Telegram channel first
- 🛠️ Admin commands: `/setcap`, `/stats`, `/broadcast`
- ☁️ Runs on Cloudflare Workers + D1, deployable **entirely from the dashboard** (no CLI)

## Deploy

See **[setup.md](setup.md)** — a step-by-step guide written for someone
deploying from a phone via the Cloudflare dashboard connected to GitHub.

## Repo layout

```
src/
  index.js          entry point (fetch + scheduled)
  webhook.js        Telegram update routing, /today, /settings
  onboarding.js     accent + level picker, lock-in
  admin.js          /setcap, /stats, /broadcast
  content.js        pick item by tier, avoid repeats
  tts.js            Gemini TTS + key rotation & failover
  telegram.js       thin Telegram API wrapper (sendAudio w/ metadata + thumbnail)
  db.js             D1 query helpers
  channelGate.js    membership gate middleware
assets/
  accentura-cover.jpg   YOU MUST DROP THIS FILE — bot album art (JPEG ≤200 kB, ≤320x320)
schema.sql                D1 schema for FRESH deployments (content_pool ships empty)
schema-migration.sql      ALTER for EXISTING deployments — adds today_audio_file_id column
content-seed.sql          ready-to-run seed: 240 facts/quotes (60 per tier)
wrangler.toml             Worker config (D1 + ASSETS bindings + cron trigger)
setup.md                  dashboard-only deployment guide
```

## Design notes

- **Voice notes vs audio:** Telegram's `sendVoice` requires OGG/Opus, which
  can't be encoded inside a Cloudflare Worker without a heavyweight WASM
  Opus encoder, AND `sendVoice` supports neither thumbnails nor
  performer/title metadata. Gemini TTS returns 16-bit PCM at 24 kHz.
  Accentura wraps that PCM into a WAV container in-memory and sends it via
  `sendAudio` — which plays inline in every Telegram client and *does*
  support `thumbnail`, `performer`, and `title` fields for a branded
  music-player-style presentation.
- **Audio metadata scheme:** every clip is sent with
  `performer = "Erastan"` (fixed brand — never falls back to "Unknown
  Artist") and `title = "Accentura — Day {N} ({accent label})"`
  (auto-generated per clip). The `/assets/accentura-cover.jpg` image is
  attached as the album-art thumbnail. If the image file is missing, the
  audio still goes out with performer + title, just no cover.
- **TTS caching:** the first `/today` call of a given day generates + uploads
  audio via Gemini + `sendAudio`. The returned Telegram `file_id` is
  persisted in `users.today_audio_file_id`. Subsequent same-day calls
  (repeat `/today`, or the cron delivering the same day) resend via
  `file_id` without hitting Gemini or re-uploading bytes. The cron clears
  `today_audio_file_id` (and `today_content_id`) when it advances the day,
  so the next day always regenerates fresh.
- **Day counter:** the daily cron is the *only* thing that advances a
  user's day. `/today` fetches (or re-sends) today's item — it never
  double-counts.
- **Restart:** `/restart` resets the existing user row in place (accent,
  level, day, `used_content_ids`, and `today_audio_file_id` all cleared).
  The `telegram_id` and `username` are preserved.
- **`/settings`:** always available. While locked, shows read-only
  accent/level/day/remaining + a streak view. After completion, exposes
  "Restart with new accent" and "View stats" inline buttons.
- **Content pool:** ships empty in `schema.sql` by design. Run
  `content-seed.sql` against your D1 database to load the ready-made pool
  of 240 items (60 per tier, 36 facts + 24 quotes each).

## License

MIT — do whatever you want with it.
