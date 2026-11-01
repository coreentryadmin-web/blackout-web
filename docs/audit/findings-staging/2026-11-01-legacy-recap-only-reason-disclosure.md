> **kind:** FINDING

## Night Hawk Legacy: live board never discloses `recap_only_reason`/`funnel` on a recap-only night — FIXED

| **Status** | Fixed |
|---|---|

**Found by:** five-engine-largo-cycle-57 live audit (2026-11-01, `check:legacy` agent), per the
standing 5-engine live monitor mandate.

**Root cause:** `src/features/nighthawk/command-deck/containers.tsx`'s `LegacyDeck()` computes
`bannerText` (lines ~468-478) and `emptyDescription` (lines ~499-503) from `edition.recap_only`
alone and never reads `edition?.recap_only_reason` or `edition?.funnel` — even though the backend
already computes and returns the exact reason via `meta.recap_only_reason`
(`src/features/nighthawk/lib/types.ts:118-119`, whose own doc comment states the intent: *"Ops
already stores this in meta.recap_only_reason — members see a one-line explanation when
present."*).

**Live proof (2026-11-01, production `GET /api/market/nighthawk/edition`):**
```json
{
  "edition_for": "2026-11-02",
  "recap_only": true,
  "recap_only_reason": "No scored dossiers after 2 dossier-fetch attempt(s) (20 candidate(s)).",
  "funnel": { "candidates": 20, "ranked": 0, "dossiers": 0, "synthesized": 0, "critic_passed": 0, "published": 0 }
}
```
A real pipeline failure (20 real candidates, 0 ever scored) rendered identically to an honest
zero-candidate quiet night — the exact "degraded without disclosure" defect class this audit
mandate exists to catch.

**Why this shipped:** a sibling component, `PlaybookBoard.tsx`, already does the correct thing
(reads and renders `edition?.recap_only_reason`, shipped 2026-07-29 per `FINDINGS.md:128862`) —
but `PlaybookBoard` is dead code, imported only by its own test file. The live-serving path
(`LegacyDeck` → `LegacyPickLogBoard`) never received the same wiring — a "fix landed in the
wrong/superseded file" miss.

**Fix:** extracted a small pure helper, `withRecapOnlyReason(baseText, reason)`
(`src/features/nighthawk/command-deck/deck-session-ui.ts`), that appends the real reason to the
base banner/description text when present and leaves it unchanged when absent/blank (never
fabricates one). Wired it into both `bannerText` and `emptyDescription` in `containers.tsx`.
Deliberately left `PlaybookBoard.tsx` untouched (out of scope — dead code, not the live path) and
did not touch `edition?.funnel`'s raw stage counts (the reason string already summarizes them for
a member-facing banner; a richer funnel breakdown is a separate, larger UI decision).

**Evidence (RED → GREEN):** added two test cases to
`src/features/nighthawk/command-deck/deck-session-ui.test.ts`. RED (via `git stash` on
`deck-session-ui.ts` alone): `TypeError: withRecapOnlyReason is not a function`, 2 failing. GREEN
(post-fix): `npx tsx --experimental-test-module-mocks --test deck-session-ui.test.ts` → 11/11
pass. `npx tsc --noEmit`: clean.

**Blast radius:** both call sites in `LegacyDeck()` fixed at the single shared helper. No other
component reads `recap_only_reason` from this live path.
