## 2026-09-10 — [FINDING, P2 SEO/GEO/product] Night Hawk Swings has ZERO public content representation — no learn guide, no manifest entry, no FAQ, no llms.txt line — despite being a live, real-money product

> **kind:** `FINDING`

| | |
|---|---|
| **Severity** | **P2** — content/discoverability gap, not a data-correctness bug. A prospective member (or an AI answer engine reading `llms.txt`/structured data) has no way to learn Night Hawk Swings exists at all, while every other live product on the platform has a dedicated learn guide, manifest entry, and FAQ answer. |
| **Found by** | DISCOVERY-lane GEO sweep, 2026-09-10, while verifying `llms.txt`'s curriculum coverage against the live product set |
| **Status** | CONFIRMED, write-up only — this is a content-authoring task (new learn guide + copy + nav wiring + sitemap/llms.txt entries), not a small self-contained code fix, so it is logged for the owning lane / operator rather than built unilaterally per the standing DISCOVERY-lane brief. |

### What was checked

Night Hawk Swings ("Swing" engine — `src/lib/swing/*`) went **LIVE with real member money on
2026-07-24** (`FINDINGS.md`'s own `## 2026-07-24 — [GO-LIVE, REAL MONEY] SWING engine taken LIVE —
commit + roll now open REAL member positions` entry) and has since received more engineering
investment than almost any other single feature on the platform — the Ask Largo × Night Hawk
Swings standing ownership mandate in `CLAUDE.md` itself calls it out by name and explicitly lists
"0dte, Swings, Legacy" as the three components of "the complete Night Hawk product."

Checked every public-facing surface a member or a GEO/AEO crawler would read to learn what the
platform offers:

| surface | swing mentioned? |
|---|---|
| `https://blackouttrades.com/llms.txt` (live, fetched today) | **No** — the Night Hawk curriculum section lists only the 0DTE Command guide and the Evening Edition guide; zero swing/swings entries anywhere in the file |
| `src/lib/learn/guides/instruments/night-hawk.ts` (150 lines, the dedicated Night Hawk Academy guide) | **No** — `grep -ic swing` → `0`. Covers only 0DTE Command + Evening Edition (desk layout, edition blocks, morning-confirm badges, carry logic) |
| `/learn/night-hawk-swings`, `/learn/night-hawk-swing`, `/learn/night-hawk-swings-guide` (live routes) | **404** on all three — no such page exists |
| `src/lib/marketing/product-manifest.ts`'s `hawk` entry (`positioning`/`lifecycle`/`capabilities`/`faqAnswer` — the canonical single source for capabilities, FAQ, pricing, and JSON-LD schema per that file's own PR #3307 header) | **No** — describes Night Hawk as exactly two components: "0DTE Command runs during RTH... Evening Edition publishes post-close prep for the next session. One desk for the full session arc — not a swing-only product." Swing is not named as a third component anywhere in the entry. |
| `BANNED_PUBLIC_MARKETING_PHRASES` (same file, line 244) | Contains the literal string `"swing playbook"` — the only occurrence of the word "swing" anywhere in the marketing layer besides the two "not swing-only" disclaimers |

`grep -rln "swing" src/lib/marketing/` returns exactly three files, and of those only
`product-manifest.ts` itself contains the word outside test files — and every occurrence in it is
either a caution against over-describing Night Hawk as swing-only, or the banned-phrase entry.
There is no affirmative sentence anywhere in the marketing/learn/SEO layer that tells a reader
Night Hawk Swings exists.

### Why this reads as a gap, not the intended restraint

The `product-manifest.ts` file carries a standing comment (line 6): *"Never describe Night Hawk as
swing-only"* — and `BANNED_PUBLIC_MARKETING_PHRASES` bans `"swing playbook"`. Read in isolation
those look like a deliberate decision to de-emphasize Swings. But tracing the history
(`git log -S'"swing playbook"'` → PR #3307, 2026-09-01) shows the actual intent was narrower: at
the time, Night Hawk's public positioning was being corrected FROM an old framing that presented
Night Hawk as overnight/swing-focused TO the current framing centered on 0DTE Command as the
primary always-on intraday product. The ban is about not mis-representing Night Hawk's *primary*
identity as swing-only — it says nothing about omitting Swing as a real, live, separately-tracked
third component entirely. And critically, **Swing went live with real money on 2026-07-24, before
this September 1st messaging correction** — so the correction's silence on Swing reads as an
omission from that pass, not a considered decision to keep Swing unlisted. Every other live
product on the platform (SPX Slayer, Vector, Helix, Meridian, Largo, and Night Hawk's own two
other components) has a manifest entry, a learn guide, and an `llms.txt` line. Swing, despite being
the platform's most actively developed live-money feature this quarter, has none of the three.

### Blast radius (every surface that would need a coordinated update, not a single-file fix)

- `src/lib/marketing/product-manifest.ts` — `hawk.positioning`/`lifecycle`/`capabilities`/
  `faqAnswer` would need a genuine third-component mention (not just "not swing-only"); consumed by
  FAQ, plan-matrix, onboarding, upsell, JsonLd `featureList`, `/vs/others`, welcome-sequence emails,
  and learn cross-links per that file's own PR #3307 description — a single edit propagates
  everywhere automatically, same as the nav-descriptor fix in the existing `## LEARN_NAV` finding
  above in this file did for the 0DTE/Evening-Edition split.
- `src/lib/learn/nav.ts` (`LEARN_NAV`) — the Learn hub's hand-authored chapter descriptor; would
  need either an amended `night-hawk` description or (more accurately, given Swing's distinct
  real-money commit/roll lifecycle, five-truth grading, and archetype/regime gating — a genuinely
  different product shape from both 0DTE Command and Evening Edition) a new chapter.
  `product-manifest-consistency.test.ts` already exists as the regression guard this kind of change
  would extend, per the earlier LEARN_NAV fix's own precedent.
- `src/lib/learn/guides/instruments/night-hawk.ts` — would need a new "Swings" section (desk
  layout, commit/roll/thesis-health lifecycle, archetype/regime gates, the five-truth grading model
  documented in `docs/audit/SWING-ENGINE.md` §4) or a sibling guide file, mirroring the existing
  per-product guide files (`vector.ts`, `meridian.ts`, `spx-slayer.ts`, `helix-flows.ts`).
- `llms.txt` generation — whatever drives the curriculum list (likely sourced from `articles.ts`/
  `LEARN_NAV`) would pick up a new guide automatically once one exists, same as every other product.
- Sitemap — a new learn slug needs a sitemap entry (checked separately: `src/app/robots.ts` was
  read this session and found complete against the current route tree, but a new route added later
  would need the same verification).

### Suggested fix shape (for whichever lane picks this up — not built here)

1. Decide Swing's public positioning with the operator/marketing owner: a third `hawk.capabilities`
   bullet + `faqAnswer` mention (minimal), or a fully separate manifest product entry given Swing's
   materially different mechanics (real multi-session thesis tracking, roll chains, five-truth
   grading) from both 0DTE Command's intraday scan and Evening Edition's next-day digest (larger,
   more accurate, more work).
2. Add a dedicated learn guide (new file or new section in `night-hawk.ts`) covering: what a swing
   play is, the commit → thesis-health → roll/close lifecycle, the archetype/regime framework, and
   how grading differs from 0DTE (five independent truth families vs. a single win/loss, per
   `docs/audit/SWING-ENGINE.md` §4 and the "why a naive single ledger was rejected" note already in
   this FINDINGS.md file).
3. Extend `product-manifest-consistency.test.ts` with the same discipline the 2026-08-xx LEARN_NAV
   fix used — assert the new copy exists and doesn't drift from the manifest, so this can't silently
   regress the way the swing-only framing drifted from the manifest before.
4. Re-verify `llms.txt`/sitemap pick up the new guide once shipped (both are checked read-only
   above; neither was modified by this finding).

No code was changed for this finding — it is a content/positioning decision that needs a human or
the owning marketing/content lane's judgment on how prominently to position a real-money feature,
not a mechanical bug fix. Flagged per the standing FULL-LIFECYCLE SCOPE EXPANSION mandate's GEO/SEO/
product-enhancement scope and the Ask Largo × Night Hawk Swings standing ownership mandate's
explicit instruction to cover "the complete Night Hawk product... 0dte, Swings, Legacy."
