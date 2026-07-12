# Accentura — assets/

Drop your bot's cover image here as **`accentura-cover.jpg`** (JPEG, ≤200 kB,
≤320×320 px — Telegram's limits for audio thumbnails).

- `accentura-cover.jpg` — preferred (JPEG)
- `accentura-cover.png` — accepted fallback

The Worker binds this directory as `env.ASSETS` (see `wrangler.toml`) and
attaches whichever of the two files it finds as the album-art thumbnail on
every `/today` audio delivery.

If neither file is present, delivery still works — audio is sent with the
`performer` / `title` metadata but no thumbnail. The Worker logs a warning
and continues so a missing cover never blocks users.

**Do not check in a real image via this repo if you don't want it public.**
On a public GitHub repo, anyone can see the file. If that matters, upload
the image after cloning locally, or via GitHub's web upload directly into
this folder just before deploying.
