> **kind:** FINDING

## Ask Largo `get_cross_product_read` never fanned out to Night Hawk Swings — PR TBD — fix/cross-product-read-missing-swing — 2026-09-20

| | |
|---|---|
| **Status** | FIXED |
| **Severity** | P2 |
| **Area** | Ask Largo — cross-product integration layer |

**What was found:** `get_cross_product_read` is the ONLY Largo tool that answers a genuinely
cross-desk question ("where do the desks disagree on NVDA", "what matters right now") — its own
tool description and `system-prompt.ts`'s "Cross-product questions" section both instruct the model
to call it instead of assembling an answer itself, specifically so a real disagreement is never
smoothed away in prose. `ProductId` (`src/lib/largo/contract/product-read.ts`) was
`"helix" | "thermal" | "vector" | "meridian" | "nighthawk" | "spx"` — **Night Hawk Swings had no
`ProductId`, no adapter, and no `SOURCES` entry in `cross-product-read.ts` at all.** It was not an
"absence with a reason" (the contract's normal, honest failure mode, C3) — it was never asked in the
first place. A member asking about a ticker with a real, open Swing position got a cross-product
read that structurally could not surface Swing's own directional stance, could not vote it into a
camp, and could not represent a genuine Swing-vs-other-desk split — the exact class of signal this
tool exists to protect from being silently reconciled away.

This is the reverse direction of the gap this session's standing mandate already names as worth
looking for: "does the swing play-brief ever compare against SPX/0DTE for the same underlying" — it
does not need to, because `get_cross_product_read` is supposed to be the one place that comparison
happens for ANY two (or more) desks, and Swing had fallen out of it entirely.

**Why this wasn't caught by existing tests:** `cross-product-read.test.ts`'s own tests hardcode the
product count (`"2/6 products reporting"`, `missing.length === 6`) — every test that asserted
"insufficient coverage" or "6 distinct reasons" was, by construction, only ever exercising the six
products that WERE wired, so a product that was never added had no test surface that could catch its
absence. The gap was invisible from inside the test suite by design (a suite can't miss a fixture it
never had reason to write) — it only surfaces by reading the tool's own claimed fan-out list against
`SOURCES` and finding they didn't match.

**What changed:**
- `ProductId` gained `"swing"` (`product-read.ts`).
- New `swingContribution(payload, queriedTicker)` adapter (`product-adapters.ts`), following the
  exact pattern of `spxContribution`/`nighthawkContribution`: reads `get_swing_play_brief`'s payload
  (`swing-play-brief-read.ts` → `composeSwingPlayBrief`) and derives direction from
  **`envelope.bias`** — the SAME field the member-facing brief panel itself renders
  (`biasFromDirection(play.direction)` in `play-brief.ts`) — never re-derived independently, so this
  adapter can never disagree with the brief a member would read for the same ticker. An
  `available: false` payload (no open/watch/recently-closed position on this ticker) is carried
  through as an honest, reasoned absence, matching every other adapter's C3 discipline.
- `SOURCES` in `cross-product-read.ts` gained a `get_swing_play_brief` entry, with the same
  identity fix `nighthawk`/`spx` already needed: the ticker is threaded explicitly into
  `swingContribution(r.value, ticker)` (queried-ticker parameter), not inferred from the raw payload
  alone.
- `tool-defs.ts`'s `get_cross_product_read` description updated to name Night Hawk Swings in the
  fan-out list and correct the product-count language (6 → 7) so the tool's own description matches
  its real behavior — the same kind of drift this bug itself was.

**Evidence:**
- New regression test `"BUG FIX 2026-09-20 — Night Hawk Swings is fanned out and can cast a real
  vote (was missing entirely)"` (`cross-product-read.test.ts`) — RED pre-fix (`git stash` on the
  three source files alone, test file kept: `swing` never reports, `read.verdict` reads `aligned`
  instead of the real `split` a dissenting Swing position should produce), GREEN post-fix.
- New adapter-level test `"swing votes from the play-brief envelope's own bias, and reports a real
  absence reason when there is no position"` (`product-adapters.test.ts`), plus `swingContribution`
  added to the existing "every adapter survives a garbage payload" regression.
- Five pre-existing tests updated from hardcoded `6`/`"2/6 products reporting"` to `7`/`"2/7..."` —
  these were never wrong, just written before a 7th product existed.
- `npx tsx --experimental-test-module-mocks --test` across all of `src/lib/largo/**/*.test.ts`:
  **1328/1328 pass** (was 1300 pre-fix, +28 net from the new/updated tests).
- `npx tsc --noEmit` → clean.

**Blast radius:** `ProductId` is a shared type read by `cross-product.ts` (join logic, generic over
`ProductId`) and `product-read.ts` (`ProductSignal`) — both already generic, so adding a union member
required no other code change. No other adapter, tool, or consumer reads a hardcoded list of
`ProductId`s (checked via repo-wide grep); the only literal `6`/`"2/6..."` occurrences were the test
assertions updated here. `swing-play-brief-read.ts` and `composeSwingPlayBrief` themselves are
unchanged — this PR only adds a NEW caller of the already-shipped `get_swing_play_brief` tool.
