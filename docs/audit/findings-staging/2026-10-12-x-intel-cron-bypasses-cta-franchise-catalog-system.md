## The entire x-intel CTA/franchise/visual-capture-catalog subsystem is built, tested, and completely bypassed by the live X-posting cron — OPEN (architecturally significant, not fixed here)

> **kind:** `FINDING`

| | |
|---|---|
| **Area** | `src/app/api/cron/x-intel/route.ts`, `src/lib/x-intel/*` |
| **Severity** | P2 (shipped product feature silently inert — not a correctness bug in what runs, but a large built feature never actually runs) |
| **Status** | OPEN |

### What's wrong

The live cron that writes every real X (Twitter) post-queue row is `src/app/api/cron/x-intel/
route.ts`. It imports only `saveQueueRow` and the `XIntelQueueDraft` type from `x-intel/` — the
post **content** itself comes from a separate, simpler module, `@/lib/x-content`
(`generateTweetContent`), which has zero references to `x-intel` at all. Concretely, every row
this cron writes hardcodes (confirmed directly, `route.ts:160-267`):

- `cta: null` (3 write sites: lines 166, 208, 267) — the entire `cta.ts` CTA-rotation/UTM-
  tagging/promo-code system (`buildCta`, `selectCtaVariant`, `LINKS`, `PRICING`, `PROMO_CODE`)
  is never invoked in production. Its only non-test caller is `queue-fixtures.ts`, whose own
  docstring says those fixtures are "never written to the database" — demo data for the admin
  empty state only.
- `franchise: null` and `products_referenced: []`, always (lines 160/202/261, 162/204/263) —
  `franchises.ts`'s rotation/penalty logic, `capture-catalog.ts`'s ~600-line per-product
  catalog, `view-catalog.ts`, `visual-memory.ts`/`visual-memory-persist.ts`'s novelty tracking,
  and `package-scorer.ts` are all designed to populate these fields but none is called from the
  cron.
- `attachments[0].source_url` is hardcoded to `"https://blackouttrades.com/terminal"` for
  **every** postType (line 244), regardless of whether the post is `desk_open`/`desk_flow`/
  `desk_matrix`/etc. The image is actually rendered by `renderDeskCardPng` (a composed card, not
  a surface screenshot), so this is a provenance label that never varies with content — the same
  "wrong URL recorded as the capture source" defect shape `capture-harness.ts`'s own history
  already fixed once (#3230), except here it's in the module that's actually live.

So the admin reviewer (`AdminXIntelQueuePanel.tsx`) displays real production queue rows that
never carry a CTA, franchise, or varied attachment provenance — all three are only visible on
the four fixture rows, which are demo data, not what actually ships to the live X account.

### Why this is NOT fixed here

Wiring the CTA/franchise/catalog system into the live cron is a real behavior change to a
production social-media content pipeline — it would change what actually gets posted to the
live X account (adding promo-code CTAs, UTM-tagged links, franchise-themed copy, varied
screenshot provenance). That is exactly the kind of decision this repo's standing audit
discipline says to write up rather than unilaterally build: is the dormant subsystem's design
still the intended content strategy, or stale design from before the current posting approach?
Should every post carry a CTA, or only some? Those are product calls, not something to infer
from reading the code.

### Two files are "dead" by caller-count, but NOT safe to delete

`src/lib/x-intel/visual-memory-persist.ts` (every export: `VISUAL_MEMORY_PATH`,
`emptyVisualMemoryLedger`, `parseVisualMemoryLedger`, `appendVisualMemory`,
`PUBLISH_HISTORY_PATH`, `emptyPublishHistory`, `appendPublishRecord`) and
`src/lib/x-intel/package-scorer.ts` (`scoreAttachmentPackage`, `MIN_PUBLISH_SCORE`) both have
**confirmed zero callers anywhere in the repo** (repo-wide grep, both production and test code).
Unlike the genuinely-orphaned dead exports found and removed elsewhere this session
(`marketingProductLearnHref`, `SITE_ROUTES`, `matrixGexScopeLabel`), these two are **integral,
load-bearing components of the same dormant subsystem** this finding describes —
`package-scorer.ts` scores exactly the kind of multi-attachment packages `franchises.ts`/
`capture-catalog.ts`/`view-catalog.ts` are built to assemble, and `visual-memory-persist.ts` is
the persistence layer the novelty-tracking in `visual-memory.ts` needs to actually remember
anything across cron runs. Deleting them now, on the "zero callers" test alone, would actively
work against whoever eventually wires this subsystem up — they are exactly the pieces that
wiring would need. Left in place, flagged here rather than cleaned up.

### A second, smaller hand-duplicated-link risk found in the same files

`cta.ts:81` hardcodes `whop: "https://whop.com/joined/blackout-2d9c/"` as a plain string
literal. The real site checkout (`src/lib/whop-checkout.ts`) sources its Whop URLs from env vars
(`NEXT_PUBLIC_WHOP_STORE_URL`/`NEXT_PUBLIC_WHOP_CHECKOUT_PRO`), not a hardcoded constant — the
same hand-duplicated-link shape that already caused a real dead-Discord-invite bug elsewhere in
this file (`LINKS.discord`, fixed via commit `6987f40f0`/#3006, confirmed still correct and
reconciled with `SITE.social.discord.url` today). If the env vars are ever repointed to a new
Whop store, `cta.ts`'s `WHOP`/`PROMO` CTA variants (currently unused in production per the
finding above, but would matter the moment this subsystem gets wired in) would keep linking to
the stale `blackout-2d9c` path. Also noted: `LINKS.site` = `"https://www.blackouttrades.com"`
(with `www`) vs `SITE.url`'s default `"https://blackouttrades.com"` (no `www`) — likely both
resolve, but a second small inconsistency worth normalizing whenever this file is next touched.
Not fixed here since the correct current Whop URL isn't something to infer from a grep —
flagged for whoever next touches `cta.ts` (ideally alongside wiring it up) to verify against the
live Whop dashboard and add the same cross-check `site.test.ts` already does for the Discord
link.

### Verification

Independently re-verified before writing this up (not taken on the originating sweep agent's
word alone): directly read `route.ts` and confirmed the exact line numbers and hardcoded values
for `cta`/`franchise`/`products_referenced`/`source_url` across all 3 write sites; directly read
both `visual-memory-persist.ts` and `package-scorer.ts` in full and confirmed via repo-wide
`grep` (excluding their own definitions) that neither has any caller; confirmed the Discord link
reconciliation is real and current. No code changed by this entry.
