# Entire production Cloudflare cache ruleset (8 rules) silently wiped 2026-10-18 — 3 weeks of lost edge caching, undetected

> **kind:** FINDING

## Summary
The zone-level Cloudflare `http_request_cache_settings` ruleset ("Cache rules for blackouttrades.com", ruleset id `95d2e74be110459ea6d8f0da6729dba4`), documented in `docs/CLOUDFLARE_CONFIG.md`'s "Active Rulesets" table as holding 8 rules, currently holds **zero**. `GET /zones/{zone}/rulesets/95d2e74be110459ea6d8f0da6729dba4` returns a `result` object with no `rules` key at all. Live-verified 2026-11-08: anonymous homepage (`/`) now serves `cf-cache-status: DYNAMIC` instead of the documented 2h `override_origin` edge cache; `favicon.ico` serves `BYPASS` instead of a 1-day edge cache; `robots.txt`/`sitemap.xml` serve `BYPASS`/`DYNAMIC` with the origin's own `cache-control: private, no-cache, no-store, must-revalidate, max-age=0` passing straight through (previously edge-cached 24h per `CLAUDE.md`'s own "Access reality" item 6). `/_next/static/*` assets happen to still read `HIT` only because Next.js's own `Cache-Control: public, max-age=31536000, immutable` origin header is enough for Cloudflare's default (rule-less) caching behavior to pick them up — the other 7 rules have no such origin-header safety net and are genuinely uncached.

## Evidence
- `GET /zones/{zone}/rulesets/95d2e74be110459ea6d8f0da6729dba4` (current): `{"result":{"id":"95d2e74be110459ea6d8f0da6729dba4","version":"19","last_updated":"2026-10-18T19:11:16.484485Z", ...}}` — no `rules` field, i.e. zero rules.
- `GET .../rulesets/95d2e74be110459ea6d8f0da6729dba4/versions` lists versions 1–19. Versions **12 through 19** (the last 8) were all created within **1.3 seconds of each other** on 2026-10-18 between 19:11:14.205 and 19:11:16.484 UTC — one rule deleted per version, 8 rules, 8 versions, in a tight burst. This is the signature of a programmatic delete loop (e.g. a cleanup/maintenance call that intended to touch ONE rule but iterated and deleted all of them), not 8 separate deliberate dashboard edits spread over time.
- Version **11** (`last_updated: 2026-08-09T10:52:33Z`) is the last known-good state and still holds the full, correct 8-rule set, fetched and preserved verbatim in `scripts/audit/cf-cache-ruleset-restore.mjs`:
  1. `/_next/static/*` → cache 1yr (`override_origin`), 4xx/5xx excluded
  2. `/api/market/gex-positioning` → **disabled** (intentionally, since 2026-07-29 — auth-gated, must never edge-cache)
  3. `/api/market/news` → cache 120s
  4. `/api/market/regime` → cache 30s
  5. `/api/*` (everything else) → bypass
  6. `/`, `/upgrade`, `/learn*`, `/why-blackout` (anon only) → cache 2h, bypassing on a `__session` cookie (the exact guard added 2026-07-22 after the "stuck on Sign in" incident — see `FINDINGS.md`) **and** on 24 named bot/crawler/AI-crawler user agents (Googlebot, Bingbot, GPTBot, ClaudeBot, PerplexityBot, etc. — so crawlers always see fresh content, which matters for the standing SEO/GEO mandate)
  7. `/_next/image*` → cache 1 day, 4xx/5xx excluded
  8. Static assets (favicon/manifest/robots.txt/sitemap.xml/icons/images/fonts) → cache 1 day
- Live header checks (2026-11-08, repeated twice for confidence): `/` → `cf-cache-status: DYNAMIC`; `/robots.txt` → `BYPASS`; `/sitemap.xml` → `DYNAMIC`; `/favicon.ico` → `BYPASS`.

## Impact
This is a **performance regression under the standing performance/latency mandate**, not a correctness bug — nothing serves stale or wrong data, since there is currently no caching at all on these paths. But for ~3 weeks (2026-10-18 → now), every anonymous visit to the marketing homepage/`/upgrade`/`/learn*`/`/why-blackout`, every favicon/icon/font/manifest/robots.txt/sitemap.xml request, every `/_next/image` request, and every `/api/market/news`/`/api/market/regime` read has hit origin directly instead of the edge — meaning higher ECS/ALB load and worse TTFB for the entire anonymous marketing funnel (the first-impression pages that matter most for conversion and for SEO/GEO crawl efficiency) than the documented, previously-tuned configuration. No prior audit in this cycle checked live Cloudflare ruleset state directly via the API (vs. trusting `CLOUDFLARE_CONFIG.md`'s description), which is why this went undetected for 3 weeks.

## Root cause
Unknown — the Cloudflare dashboard/API provides no audit log of *who* issued the 8 rapid deletes, only the version timestamps. Given the tight 1.3s clustering across exactly 8 deletes (matching the exact rule count), the most likely explanation is a scripted/automated call that iterated over all rules in the ruleset with a delete action intended for one rule, rather than 8 independent manual edits. This is infra state that lives only in the Cloudflare dashboard (per `CLAUDE.md`: "these cache rules are hand-made in the CF dashboard, not in blackout-infra terraform") — there is no `blackout-infra` PR or `blackout-web` commit around 2026-10-18 19:11 UTC that would explain it, and no code in this repository calls the Cloudflera Rulesets DELETE endpoint.

## Fix
`scripts/audit/cf-cache-ruleset-restore.mjs` — a committed, idempotent restore script. Default (no flags) does a read-only diff (live rule count vs. expected 8) and exits without writing. `--apply` PUTs the exact 8-rule payload (captured verbatim from the last known-good version 11) back to the ruleset, recreating it byte-for-byte including the critical `__session`-cookie and bot-UA bypass guards on rule 6, and leaving the `gex-positioning` rule explicitly disabled exactly as before.

**This PR does NOT apply the restore.** Per this repo's own "no silent AWS/infra auto-apply" discipline (the `zerodte-skip-grade`/`nighthawk-backfill-repair` precedent in `blackout-infra` PR #53/#54) and because this session's attempt to PUT the restore payload directly was denied by the harness's own auto-mode safety classifier ("Modify Shared Resources" — a live production CDN config write), actually applying the restore needs either: (a) a human running `node scripts/audit/cf-cache-ruleset-restore.mjs --apply` with `CF_API_TOKEN`/`CF_ZONE_ID` in env, or (b) a future session running with explicit permission to write this specific resource. This PR is the durable record + the ready-to-run fix, matching the `blackout-infra` "NEEDS HUMAN REVIEW + APPLY" pattern used for AWS-side changes this session can't verify/apply either.

## Verification plan (for whoever runs `--apply`)
After restoring, re-check the same four live probes above and confirm: `/` → `HIT` (anon, no `__session` cookie, non-bot UA); `/` with a real Clerk `__session` cookie → stays `DYNAMIC`/`MISS` (the auth bypass must still work — this is the exact bug class the 2026-07-22 incident was); `/robots.txt`/`/favicon.ico` → `HIT`; `/api/market/gex-positioning` → stays uncached (rule 2 must stay `enabled:false`).

| **Status** | OPEN — restore script written and verified read-only against live Cloudflare state; the actual `--apply` write requires elevated/human permission this session does not have for a live production CDN mutation. |
