# Accentura

A Telegram bot that helps you learn a target English accent by sending one
short **fact or quote per day, spoken by Gemini TTS in your chosen accent**,
for 30 days.

- 🎧 6 accents: British RP, Scottish, Irish, Australian, American General, South African
- 📚 4 difficulty levels: Beginner / Intermediate / Advanced / Progressive
- 🔒 30-day locked run — no accent/level swapping mid-run
- ⏰ Daily push via Cloudflare Cron; `/today` for on-demand
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
  webhook.js        Telegram update routing
  onboarding.js     accent + level picker, lock-in
  admin.js          /setcap, /stats, /broadcast
  content.js        pick item by tier, avoid repeats
  tts.js            Gemini TTS + key rotation & failover
  telegram.js       thin Telegram API wrapper
  db.js             D1 query helpers
  channelGate.js    membership gate middleware
schema.sql                D1 schema (content_pool ships empty)
content-seed.example.sql  placeholder content, replace before use
wrangler.toml             Worker config (D1 binding + cron trigger)
setup.md                  dashboard-only deployment guide
```

## Design notes

- **Voice notes vs audio:** Telegram's `sendVoice` requires OGG/Opus, which
  can't be encoded inside a Cloudflare Worker without a heavyweight WASM
  Opus encoder. Gemini TTS returns 16-bit PCM at 24 kHz. Accentura wraps
  that PCM into a WAV container in-memory and sends it via `sendAudio`,
  which plays inline in every Telegram client.
- **Day counter:** the daily cron is the *only* thing that advances a
  user's day. `/today` fetches (or re-sends) today's item — it never
  double-counts.
- **Restart:** `/restart` resets the existing user row in place (accent,
  level, day, `used_content_ids` all cleared). The `telegram_id` and
  `username` are preserved.
- **Content pool:** empty on purpose. Populate via
  `content-seed.example.sql` (or your own seed) once you have real facts
  and quotes.

## License

MIT — do whatever you want with it.
