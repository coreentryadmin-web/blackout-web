> **kind:** FINDING

## Homepage product-catalog copy drifted from the shared manifest + FAQ — FIXED (Meridian addition blocked on a missing asset)

| **Status** | Fixed in this PR (Meridian carousel entry tracked separately — see below) |

**Root cause (three separate drifts, one shared manifest already exists):** `src/lib/marketing/products.ts`
(`MARKETING_PRODUCTS`) is already the intended single source of truth for the homepage's product
carousel, consumed by `RedesignHome.tsx`/`ProductScroller.tsx`. Three of its entries/consumers had
drifted from what the rest of the site (and the product itself) actually says:

1. **Night Hawk's card described only half the product.** `tag: "Swing playbook"`,
   `headline: "Overnight and swing setups with receipts."`, and its bullets never mentioned
   0DTE Command — while the FAQ on the SAME homepage (`src/lib/faq/content.ts:139`) already says
   "Night Hawk evening + 0DTE Command scanners," and the public guide
   (`/learn/night-hawk-0dte-command-guide`) documents 0DTE Command as a continuously-running
   intraday scanner, not a swing-only product. A visitor could get two different definitions of
   Night Hawk without leaving the page.
2. **Vector's card contradicted its own `launchStatus`.** `launchStatus: "live"` but
   `stat: { k: "Soon", v: "universe scan" }` and a bullet reading "Rolling out as desk coverage
   expands" — while Vector's public guide documents a mature feature set (universe ranking, GEX
   ladders, regime detection, wall-integrity scoring, gamma magnet, confluence zones, GEX Shift
   Leaders, alerts, replay) that is genuinely shipped production code (confirmed via a separate
   investigation into Vector's wall-calculation implementation this session — real API routes,
   crons, and tests, not a stub).
3. **The homepage headline/cred-count were hardcoded, not derived.** `<h2>Six engines.<br/>One
   edge.</h2>` and `<li>6 live engines</li>` were literal strings independent of
   `MARKETING_PRODUCTS.length` — so the count could silently go stale the next time a module was
   added or removed, exactly as it now has (see below). The FAQ's own "How do I get access?"
   answer separately said "all six modules" while its own next answer already names seven
   (SPX Slayer + HELIX + Largo + Night Hawk + Thermal + Vector + Meridian).

**Fix:**
- Corrected Night Hawk's `tag`/`headline`/`lede`/`heroBlurb`/`bullets` to describe both halves of
  the product (evening playbook AND 0DTE Command), matching the FAQ and public guide.
- Corrected Vector's `stat`/`bullets` to describe its shipped feature set instead of "Soon"/
  "Rolling out," matching its `launchStatus: "live"` and its own public guide.
- Made the homepage headline and cred-count derive from `MARKETING_PRODUCTS.length` (new
  `capitalizedNumberWord()` helper for the stylized word-form headline) instead of hardcoded
  literals — so adding or removing a module can no longer silently desync the count from the copy.
- Fixed the FAQ's "all six modules" → "all seven modules" (the platform genuinely ships seven:
  SPX Slayer + the six Premium add-ons the very next FAQ answer already names).
- Added regression tests: no `launchStatus:"live"` module's own copy may say "soon"/"rolling out"
  (guards the Vector class of bug); Night Hawk's card must mention "0DTE Command" (guards this
  specific regression); `capitalizedNumberWord` unit tests.

**NOT fixed here — Meridian is still missing from `MARKETING_PRODUCTS` (still 6 entries, not 7):**
the homepage's product carousel (`RedesignHome.tsx`) requires a real screenshot per product via
`MARKETING_MODULE_GALLERY` (`src/lib/images.ts`, a `Record<MarketingModuleId, readonly string[]>`
keyed off `/images/marketing/<id>.webp`). No Meridian screenshot exists anywhere in
`public/images/marketing/` or the repo. Adding a `meridian` entry to `MARKETING_PRODUCTS` without
a real asset would either fail to type-check (the gallery record would be missing a key) or force
reusing another product's screenshot under Meridian's name — actively misleading. **This needs a
real Meridian screenshot committed to `public/images/marketing/` before the manifest can gain a
7th entry.** Once that asset exists, adding one `MARKETING_PRODUCTS` entry is the ONLY code change
needed — the headline/cred-count derivation added in this PR will automatically read "Seven
engines" / "7 live engines" with no further edits, which is exactly the "fix it through the shared
manifest, not by hand" approach requested in review. Flagging as a tracked follow-up rather than
silently leaving it as a stale "6" — see `docs/audit/RUN-LOG.md`/this file for the pointer.

**Also investigated this session, found NOT broken (see the companion PR for the real bug
found instead):** whether SPX Slayer/Thermal/Vector derive `call_wall`/`put_wall` from one
canonical calculation — verified yes for their default views; a real divergence was found and
fixed separately in several Largo-facing Vector reads that silently defaulted to a 0DTE-scoped
calculation instead (see `fix(largo): stop several Vector reads silently defaulting to 0DTE-scoped
walls/flip`).

**Test:** `src/lib/marketing/products.test.ts` — 3 new/changed assertions, verified fail pre-fix /
pass post-fix (`git stash`). `RedesignHome.seo.test.ts`, `faq/content.test.ts`,
`marketing-hash-nav.test.ts` (19 tests total) still pass. `npx tsc --noEmit`: clean.
