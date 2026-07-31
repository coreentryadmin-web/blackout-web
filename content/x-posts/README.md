# X (Twitter) post packages

Ready-to-copy post copy + screenshot attachments, organized **one folder per trading session**.

## Structure

```
content/x-posts/
  README.md                 ← you are here
  2026-07-30/               ← session date (America/New_York)
    README.md               ← index for that day
    market-recap.md         ← full tape + what we caught/missed
    posts/                  ← one file per post or thread
    attachments/            ← PNGs referenced by posts/
```

## How to use

1. Open `2026-07-30/README.md` for the post index.
2. Open any file in `posts/` — copy the tweet text blocks.
3. Attach the PNGs listed under **Attachments** (paths are relative to `2026-07-30/`).
4. On X: upload images from `attachments/` when posting each tweet or carousel slide.

## Regenerating captures

```bash
node scripts/capture-x-replay-posts.mjs
node scripts/capture-x-play-breakdowns.mjs
```

Then copy new PNGs into the session folder and update posts.
