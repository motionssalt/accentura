# Accentura — Setup Guide (dashboard-only, no CLI)

This guide walks you through deploying Accentura entirely from your phone (or
any browser) using the Cloudflare dashboard connected to a GitHub repo. **No
`wrangler` CLI required.**

Total time: about 20–30 minutes on a first deploy.

---

## 0. What you need before you start

- A **Telegram account**
- A **Cloudflare account** (free plan is fine)
- A **GitHub account** with this repo pushed to it (or forked)
- One or more **Gemini API keys** (from [aistudio.google.com](https://aistudio.google.com/apikey))
- A **Telegram channel** where you'll gate access to the bot (public channel, e.g. `@my_channel`)
- A **bot cover image** — JPEG, ≤200 kB, ≤320×320 px (for album art on daily audio clips)

---

## 1. Create the Telegram bot

1. In Telegram, open a chat with **[@BotFather](https://t.me/BotFather)**.
2. Send `/newbot`. Follow the prompts to pick a name and a `@username` ending in `bot`.
3. BotFather replies with a **token** that looks like `123456789:ABCdefGHIjkl...`.
   **Save this token** — you'll paste it into Cloudflare as a secret.
4. (Optional) Send `/setdescription`, `/setabouttext`, `/setuserpic` to BotFather to
   polish the bot's profile.
5. **Very important — make your bot an admin of your channel** so it can check
   membership:
   - Open your channel → **Manage Channel** → **Administrators** → **Add Admin**
   - Search for your bot's `@username` and add it.
   - It only needs read permissions (no post permission required).

If you skip step 5, `getChatMember` will always fail and every user will be
stuck at the join gate.

---

## 2. Create the D1 database

1. In the Cloudflare dashboard, go to **Workers & Pages** → **D1** → **Create database**.
2. Name it `accentura` (or anything — you'll paste the ID into `wrangler.toml`).
3. Open the database → **Console** tab.
4. **For a brand-new deployment:** open `schema.sql` from this repo, **copy its
   entire contents**, paste into the console, and click **Execute**. You should
   see the `users`, `content_pool`, `config`, and `api_key_status` tables created.
5. **For an EXISTING deployment upgrading to this version:** instead of
   re-running `schema.sql`, paste the contents of `schema-migration.sql` into
   the console and click **Execute**. This runs a single
   `ALTER TABLE users ADD COLUMN today_audio_file_id TEXT;` — safe on any
   existing DB, and required for the new per-day audio cache. It's safe to
   re-run (SQLite will error with "duplicate column name" if already applied,
   which is harmless).
6. To load the ready-made content pool (240 facts/quotes, 60 per tier), do the
   same with `content-seed.sql` — paste its contents into the console and
   execute. You can add more later with the same `INSERT INTO content_pool`
   shape (`content-seed.example.sql` is kept only as a format reference and
   doesn't need to be run).

Copy the D1 **database ID** from the top of the database page — you'll paste it
into `wrangler.toml` (see step 4).

---

## 3. Push this repo to GitHub

If you haven't already:
1. Create a new empty GitHub repo (public or private — Cloudflare supports both).
2. Push the contents of this folder to it (via GitHub web upload works fine for a phone-only workflow).

---

## 4. Edit `wrangler.toml` with your D1 database ID

Open `wrangler.toml` on GitHub (pencil icon) and change:

```toml
database_id = "REPLACE_WITH_YOUR_D1_DATABASE_ID"
```

to the actual ID from step 2. Commit the change to `main`.

You should also verify:
- `crons = ["0 8 * * *"]` — this is the daily push time in UTC. Change if you
  want a different hour. (You can also override this via the dashboard — see step 7.)
- The `[assets]` block is present (`directory = "./assets"`, `binding = "ASSETS"`).
  It's what makes the bot's cover art available inside the Worker.

---

## 4b. Drop the bot cover image into `/assets/`

Every daily audio clip is sent with **album art** (Telegram displays it in the
music player alongside the "Erastan" performer tag and the per-day title).
The image lives at `assets/accentura-cover.jpg` in this repo.

1. Prepare your image:
   - Format: **JPEG** (`.jpg` preferred; `.png` also accepted as fallback)
   - Size: **≤200 kB**
   - Dimensions: **≤320×320 px** (square recommended)
2. Upload it to the `assets/` folder in GitHub (Add file → Upload files) and
   name it exactly:
   - `accentura-cover.jpg` (preferred), OR
   - `accentura-cover.png` (fallback if you only have PNG)
3. Commit the change.

If neither file is present, the bot still works — clips will just go out
without a thumbnail (but with performer + title metadata intact). The Worker
logs a warning and continues so a missing cover never blocks users.

---

## 5. Create the Worker and connect it to GitHub

1. In the dashboard: **Workers & Pages** → **Create** → **Workers** →
   **Import a repository** (aka "Connect to Git").
2. Authorize Cloudflare on GitHub if prompted, then pick the Accentura repo.
3. **Build settings:**
   - Framework preset: **None**
   - Build command: leave empty
   - Deploy command: leave empty (Cloudflare auto-detects `wrangler.toml`)
   - Root directory: leave empty (or `/`)
4. Click **Save and Deploy**. First deploy takes ~1 minute. If it fails at this
   point, it's almost always because the D1 binding in `wrangler.toml` doesn't
   match a real database ID.

---

## 6. Bind D1 and set environment variables in the dashboard

Once the Worker exists:

1. Open the Worker → **Settings** → **Bindings** (or **Variables**).
2. **D1 database bindings** — confirm there is a binding named `DB` pointing to
   the `accentura` database you created in step 2. If it isn't there, add it
   manually: **Binding name = `DB`**, database = `accentura`.
3. **Assets binding** — confirm there is a binding named `ASSETS` pointing at
   the `assets/` directory (auto-created from `wrangler.toml`'s `[assets]`
   block on first deploy). If it isn't there, add it manually.
4. **Environment variables** — add these. Mark the sensitive ones as **Secret**
   (encrypted) using the "Encrypt" toggle:

   | Name                | Type   | Example value                                        |
   |---------------------|--------|------------------------------------------------------|
   | `TELEGRAM_BOT_TOKEN`| Secret | `123456789:ABCdef...` (from step 1)                  |
   | `REQUIRED_CHANNEL`  | Plain  | `@your_channel`                                      |
   | `ADMIN_IDS`         | Secret | `111111111,222222222` (your own Telegram user ID)    |
   | `GEMINI_KEYS`       | Secret | `["AIzaKey1...","AIzaKey2..."]` (JSON array string)  |
   | `DEFAULT_USER_CAP`  | Plain  | `500`                                                |

   How to find your Telegram user ID: message **[@userinfobot](https://t.me/userinfobot)**;
   it replies with your numeric ID.

   `GEMINI_KEYS` must be a **valid JSON array string**. Even one key looks like
   `["AIza..."]`. If you'd rather use numbered slots, you can instead set
   `GEMINI_KEY_1`, `GEMINI_KEY_2`, ... `GEMINI_KEY_100` (empty ones are skipped
   silently) — but the JSON array is cleaner.

5. Click **Save and deploy**. Every save triggers a redeploy — wait ~30 s.

---

## 7. Set the Telegram webhook

Telegram needs to know where to POST updates. Your Worker's URL will be
something like `https://accentura.<your-subdomain>.workers.dev` (visible on the
Worker's overview page).

Open the following URL **in your browser** (replace the two placeholders):

```
https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook?url=https://<your-worker>.workers.dev/webhook
```

You should see `{"ok":true,"result":true,...}`. That's it.

To verify at any time:
```
https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/getWebhookInfo
```
Look for `"url"` matching yours and `"pending_update_count": 0`.

---

## 8. Configure the cron trigger

The `wrangler.toml` in this repo already declares `crons = ["0 8 * * *"]`
(08:00 UTC daily). You can leave that as-is, or override in the dashboard:

1. Worker → **Triggers** → **Cron Triggers** → **Add Cron Trigger**.
2. Enter a schedule (e.g. `0 8 * * *` for 08:00 UTC daily) and save.

The scheduled handler in `src/index.js` will run on that schedule and push the
day's audio to every locked user.

---

## 9. Seed content

The bot ships with `content_pool` **empty by design**. Until you seed it,
`/today` will politely tell users no content is available.

1. In the dashboard: **D1 → accentura → Console**.
2. Open `content-seed.sql` from this repo, copy its entire contents, paste
   into the console, and click **Execute**. This loads the ready-made pool:
   240 items total, 60 per tier (36 facts + 24 quotes each).
3. Verify with:
   ```sql
   SELECT tier, COUNT(*) FROM content_pool GROUP BY tier;
   ```
   You should see 60 rows per tier (1–4).

Want more variety later? Add rows anytime with the same
`INSERT INTO content_pool (tier, type, text) VALUES (...)` shape.
`content-seed.example.sql` is just a format reference for that — it isn't
used by the running bot and doesn't need to be executed.

---

## 10. Admin commands (day-to-day)

From any Telegram chat with the bot, as a user whose Telegram ID is in
`ADMIN_IDS`:

- `/setcap 200` — cap active learners at 200. Existing users are unaffected;
  new `/start` attempts get a "spots full" message once the cap is reached.
  Use `/setcap 0` to remove the cap entirely.
- `/stats` — total users, active/locked, completed, users per accent, and the
  current cap.
- `/broadcast Hello everyone!` — send a message to every user. Paced at
  ~25 messages/second to stay under Telegram limits.

Regular users see:
- `/start` — begin (or resume) a 30-day run
- `/today` — get today's practice on-demand (first call of the day generates
  fresh audio; repeat calls the same day reuse the cached Telegram file_id
  and skip the Gemini TTS call entirely)
- `/status` — see current day / accent / level
- `/settings` — inline-button panel: locked users see read-only info +
  streak view; completed users get "Restart with new accent" + "View stats"
- `/restart` — begin a new 30-day run **after** finishing the current one
- `/setaccent`, `/setlevel` — refused while locked into an active run

---

## 11. Troubleshooting

### The webhook isn't firing / bot doesn't respond
- Confirm `getWebhookInfo` returns your `/webhook` URL and no `last_error_message`.
- Check the Worker's **Logs** tab (Workers & Pages → your worker → Logs) while
  you send `/start` in Telegram. You should see a log line per incoming update.
- If the log shows `Telegram sendMessage failed`, your `TELEGRAM_BOT_TOKEN` is
  probably wrong or unset. Re-check step 6.

### Everyone is stuck at the "join channel" gate
- The most common cause: **the bot is not an admin of the channel**. Fix in
  step 1.5.
- Second most common: `REQUIRED_CHANNEL` has a typo (must be exactly `@handle`
  for public channels).

### TTS is failing silently (no audio, generic error)
- Send `/today` and immediately watch the Worker Logs.
- `Gemini key #N failed: HTTP 401` → your key is invalid; regenerate it.
- `Gemini key #N failed: HTTP 429` → rate-limited; that key auto-cooldowns for
  10 minutes and the next key is tried.
- `No Gemini API keys configured` → your `GEMINI_KEYS` var is unset or not
  valid JSON. It must be a JSON array string, e.g. `["AIza..."]`.

### Audio comes through with no album art
- Confirm `assets/accentura-cover.jpg` (or `.png`) exists in the repo and was
  pushed to the deployed branch.
- Check the Worker Logs for `Cached file_id resend failed` or similar — the
  cover-loading path swallows errors and logs a warning, so a missing / oversized
  file will show up there. Telegram enforces JPEG ≤200 kB and ≤320×320 px.

### Audio doesn't show "Erastan" as performer
- Both `performer` and `title` are set on **every** send in `webhook.js`.
  If they don't render, you're probably looking at an older cached message —
  the audio metadata is set per-message, so newly delivered clips will show
  the updated values. Trigger a fresh delivery by advancing the day
  (`/run-cron?token=...`) or from a user whose `today_audio_file_id` is null.

### D1 error: `no such column: today_audio_file_id`
- You have an existing deployment and haven't run `schema-migration.sql` yet.
  Do step 2.5. This is the exact migration path for that error.

### D1 errors on deploy or in logs
- `no such table: users` → you didn't run `schema.sql` in the D1 console. Do
  step 2.4.
- `D1_ERROR: near "...": syntax error` when seeding content — your seed SQL
  has an unescaped apostrophe. In SQLite, escape by doubling it: `it''s`.

### Cron doesn't seem to run
- Check **Triggers > Cron Triggers** — is it enabled?
- Cron on the free plan runs on a best-effort basis; expect it within a
  minute or two of the scheduled time.
- Use `POST https://<your-worker>.workers.dev/run-cron?token=<TELEGRAM_BOT_TOKEN>`
  from a browser extension / mobile HTTP client to trigger the job manually
  for testing. (The token check is intentional — this endpoint reuses your bot
  token so nobody else can trigger it.)

### I want to reset a specific user
Run this in the D1 console (replace the ID):
```sql
UPDATE users
   SET accent_key = NULL, accent_prompt = NULL, level = NULL,
       current_day = 1, locked = 0, used_content_ids = '[]',
       today_content_id = NULL, today_audio_file_id = NULL,
       started_at = NULL, completed_at = NULL
 WHERE telegram_id = 123456789;
```
The next `/start` from that user will re-run onboarding.

### Force-regenerate today's audio for a specific user
If you want a user's next `/today` to hit Gemini fresh (e.g. after changing
the accent prompt), just clear the cached file id:
```sql
UPDATE users SET today_audio_file_id = NULL WHERE telegram_id = 123456789;
```

---

## 12. What "locked in" means, for users

- After a user picks accent + level with `/start`, they are **locked** for 30 days.
- `/setaccent` and `/setlevel` are refused while locked.
- The daily cron sends one audio + caption per day, in order.
- On day 30, they get a completion message, `locked` flips to 0, and `/restart`
  becomes available.
- `/restart` **resets their existing row** (accent, level, day, used_content_ids,
  today_audio_file_id all cleared) and re-runs onboarding. Their `telegram_id`
  and `username` are preserved.
