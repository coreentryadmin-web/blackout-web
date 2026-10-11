## SPX `spx-play-lotto.ts` re-export shim — dead, deleted entirely (correction to a 2026-09-05 FINDINGS.md entry) — FIXED

> **kind:** `FINDING`

| **Status** | Fixed in PR (fix/spx-dead-lotto-reexports) |
|---|---|

**Symptom:** none live — pure dead code found during a routine DISCOVERY-lane sweep, not a
production defect.

**Root cause:** `src/features/spx/lib/spx-play-lotto.ts` was a `@deprecated` one-file re-export
shim re-exporting `evaluateSpxLotto`, `evaluateSpxLotto as evaluateLottoPlay`,
`consumeLottoOnBuy`, and `type LottoPlayPayload` from `spx-lotto-engine.ts`. Of the two real
importers of this file (`spx-play-engine.ts`, `spx-play-payload.ts`), both imported ONLY the
`LottoPlayPayload` type — `import type { LottoPlayPayload } from ".../spx-play-lotto"` — never any
of the 3 function re-exports. `evaluateLottoPlay` additionally already has its own direct alias in
`spx-lotto-engine.ts` itself (`export const evaluateLottoPlay = evaluateSpxLotto;`), so even the
one re-export with a "real" shape elsewhere was doubly redundant.

**Correction to an existing finding:** `docs/audit/FINDINGS.md`'s 2026-09-05 "Eight more
`@deprecated` exports" entry already examined this exact file and concluded it should be left
alone because it had "real callers" (`spx-play-engine.ts`, `spx-play-payload.ts`) — but that check
didn't distinguish a type-only import from a value import. Both real callers only ever imported the
type; `git log -p` on `spx-play-engine.ts` shows it has done only the type-only import since this
shim's own creation (`83d3dedf6`). The three function re-exports had zero real callers then and
have zero now — this finding corrects that entry rather than treating it as newly discovered.

**Evidence:** `grep -rn "from [\"']@/features/spx/lib/spx-play-lotto[\"']" --include=*.ts
--include=*.tsx src scripts` → exactly 2 hits, both `import type { LottoPlayPayload }`.

**Fix:** Redirected both importers to import `LottoPlayPayload` directly from
`@/features/spx/lib/spx-lotto-engine` (where the type is actually defined) and deleted
`spx-play-lotto.ts` entirely — once both type importers were redirected, nothing referenced the
shim at all.

**Fix rationale:** Deletion rather than trimming the shim down to just the type re-export, since a
one-line re-export file whose only purpose was backward-compat for a migration that's long since
finished buys nothing over importing the type from its real home directly.

**Blast radius:** `src/features/spx/lib/spx-play-lotto.ts` (deleted),
`src/features/spx/lib/spx-play-engine.ts`, `src/features/spx/lib/spx-play-payload.ts` (import path
updated only — no behavior change, same type, same underlying module). No test file existed for the
shim.

**Regression guard:** `spx-play-engine.test.ts` 5/5 pass, `spx-play-payload.test.ts` 7/7 pass (Node
20, `--experimental-test-module-mocks`). `tsc --noEmit` clean.
