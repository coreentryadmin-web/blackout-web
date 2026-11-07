> **kind:** FINDING

## 2026-11-07 — `docs/audit/MERIDIAN-MAP.md` §6.1 described the BMO reaction-anchoring defect as unfixed ("Fix not written — Phase 0 gate"), but PR #2663 shipped the fix the same day the map was merged — FIXED (docs)

| **Status** | FIXED on `fix/meridian-map-stale-bmo-fix` (docs-only) |
| --- | --- |

**Symptom:** `docs/audit/MERIDIAN-MAP.md` §6.1 ("P1. The BMO half of the reaction anchor has the
exact defect the AMC half was fixed for") describes a live defect — a BMO (pre-open) earnings
print's `reaction_pct` is computed as the anchor session's own `session_open_to_close`, which
drops the premarket gap, causing 27.0% of a measured 519-print BMO cohort to display the opposite
sign (DDOG, PODD, SE, ONON, VWDRY named as examples). §6.1 ends with *"Fix not written — Phase 0
gate. The read to replace it is settled in §6.1.1."* §6.1.1 documents the measurement that chose
the replacement ("ship B": anchor at `prior_close_to_close` instead) but likewise never states it
shipped. §6.4's "GREEN, verified, do not re-litigate" list and the closing Phase-0-gate note both
omit the BMO fix and explicitly say *"§6.1 and §6.2 are documented here rather than fixed."*

That was accurate when the map was merged (PR #2639, 2026-08-22 16:54 PT) — but **PR #2663
("fix(meridian): a pre-open print's reaction dropped the premarket gap — 27% of BMO prints shown
with the wrong sign") merged the same day at 18:46 PT, under two hours later**, and shipped
exactly the §6.1.1 "ship B" decision. The map was never updated to reflect it, so it has read
"not fixed" on an already-fixed defect for roughly eleven weeks — the same staleness shape round
373/374 found and fixed in `HELIX-MAP.md`/`THERMAL-MAP.md`.

**Verification against current `main` (`92a1b1e51`, 2026-11-07):**

```
src/lib/meridian/meridian-reaction-core.ts — reactionForPrint():
  const priorCloseYmd =
    timing === "amc" ? reportYmd : timing === "bmo" ? prevSessionYmd(orderedYmds, reportYmd) : null;
  const priorClose = priorCloseYmd != null ? byYmd.get(priorCloseYmd)?.c : undefined;
  const spansClosedMarket = timing === "amc" || timing === "bmo";
  const reaction_pct = spansClosedMarket
    ? (priorClose != null && anchorBar != null ? pctChange(priorClose, anchorBar.c) : null)
    : rx.session_change_pct;   // "unknown" timing only — exactly what §6.1.1 specified
```

Both `amc` and `bmo` now compute `priorCloseYmd` and read `prior_close_to_close` (or
`prior_close_to_last` while the anchor session is still open); `session_open_to_close` is reached
only when `timing === "unknown"`. The new `reaction_includes_prior_drift` field §6.1.1 called for
(the honest residual on a `prior_close_to_*` read) is also present and tested.

`git log --oneline -- src/lib/meridian/meridian-reaction-core.ts` confirms the fix commit:
`ee3501f17 fix(meridian): a pre-open print's reaction dropped the premarket gap — 27% of BMO
prints shown with the wrong sign (#2663)`, dated 2026-08-22 18:46 -0700 — after the map's own
merge commit `a6f2bb0d3` (#2639) at 16:54 -0700 the same day.
`meridian-reaction-core.test.ts` carries direct coverage: a BMO print's `reaction_measure` is
asserted `"prior_close_to_close"` (not `"session_open_to_close"`), `reaction_includes_prior_drift`
is asserted `true` for a BMO print with a real prior close, `false` for AMC, and `null` when
there is no prior bar to anchor to; `14/14` pass, Node 20.20.0.

**Checked §6.2 is still accurate and was left alone:** `reaction_basis`/`reaction_measure`/
`reaction_settled` are still not read by any component under `src/features/meridian/components/`
(grep confirms they appear only in the type definition) — that half of the Phase-0 gate genuinely
remains open, so only §6.1 is marked fixed here.

**Fix (docs-only):** §6.1's heading now carries `— FIXED`, with a `**FIXED — #2663 (...)**`
paragraph (matching the style §9.1–§9.4 already use in `THERMAL-MAP.md`) quoting the shipped
logic and the re-verification; the "Fix not written" line at the end of the narrative is updated
to "Shipped — #2663"; §6.1.1's own heading now says "...decision shipped"; §6.4's GREEN list gets
a new bullet for the BMO fix; the closing Phase-0-gate note is rewritten to say §6.1 shipped while
§6.2 remains open; and §7 item 1 now notes the fix shipped rather than only that it was measured.
No source files changed.

**Blast radius:** `docs/audit/MERIDIAN-MAP.md` only.

**Evidence:**
- `git log --oneline -- src/lib/meridian/meridian-reaction-core.ts` — `ee3501f17` (#2663) is the
  fix commit, dated after the map's own merge commit the same day.
- Direct read of `src/lib/meridian/meridian-reaction-core.ts` on `main` at `92a1b1e51` confirms
  the fix is still in place today (both `amc` and `bmo` compute `priorCloseYmd`;
  `session_open_to_close` reached only for `unknown` timing).
- `npx tsx --experimental-test-module-mocks --test src/lib/meridian/meridian-reaction-core.test.ts`
  — 14/14 pass, Node 20.20.0.
- `npx tsc --noEmit` — clean (no errors; the pre-existing nighthawk `legacy-option-marks-server.ts`
  issue mentioned in the round brief is already fixed on `main` per PR #7522).
- Full `npm test` run before merge (docs-only change, no source touched).

Found via lead #1 in the round-375 prompt ("read `docs/audit/MERIDIAN-MAP.md` fully and
cross-check every present-tense factual claim against current source" — the methodology that
already found real hits in `HELIX-MAP.md` and `THERMAL-MAP.md`).
