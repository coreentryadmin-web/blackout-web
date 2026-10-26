> **kind:** FINDING

## evidenceFromContext drops the entire Dealer-posture evidence item whenever gamma_posture is unresolved, even though net GEX/nearest wall are live — FIXED

| **Status** | Fixed |
|---|---|

**Where:** `src/lib/swing/play-brief.ts`, `evidenceFromContext()` (~line 1360, the `if (gammaPosture)`
block ~line 1440-1515).

**Root cause:** The net-GEX dollar figure, the nearest-wall/flip distance, AND the whole CALC
evidence item were all computed and pushed only *inside* `if (gammaPosture) { ... }`, where
`gammaPosture = resolveGammaPosture(ctx, vec, readMs)`. `resolveGammaPosture`
(`play-brief-absence.ts:461-474`) returns `null` whenever the GEX matrix's own `gamma_posture` is
`null` (and Vector's regime posture doesn't independently resolve it) — a real, common case:
`buildGexRegime` (`gex-cross-validation-core.ts`) sets `posture: null` whenever the flip itself is
null for a genuine structural reason (`insufficient_strikes`/`crossings_far_from_spot`; the third
null-flip reason, `net_short_everywhere`, resolves posture to `"short"`, not null). So a null
`gamma_posture` silently dropped the ENTIRE evidence item — not just the posture word — even though
net GEX / nearest wall are computed from different, independent fields (`gex.net_gex`,
`gex.call_wall`/`gex.put_wall`) that are unaffected by the flip being null.

Meanwhile the human-facing `gexPostureSection` (`play-brief-intel.ts` ~3072-3158) renders Net
GEX/VEX/DEX/CHARM/Nearest-wall each gated only on `!stale`, never on `gamma_posture` resolving — so
the model-facing `envelope.evidence[]`/`evidence_numbers` (Largo contract C7) saw strictly less than
the member-facing markdown for the identical brief.

**Evidence:** live-reproduced 2026-10-26 via a temp Clerk premium session against
`GET /api/market/swing/play-brief` for CLOSED MRNA (positionId 65): the brief's markdown "GEX
posture" section rendered "Net GEX: +9.6M", "Net VEX (vanna): 889.7M...", "Net DEX (delta):
-3.2B...", "Net CHARM (pinning): -12.3B...", "Nearest wall: 210.00 (resistance, 13.0 pts from spot
197.03)" — all live — yet `envelope.evidence[]` for that exact brief contained zero
[CALC]/dealer-posture entries (only 5 [FACT] items: HELIX flow, earnings, peers, short interest,
setup score). Sibling CLOSED briefs fetched the same run (GOOG:64, NVDA:62) both DID carry a
`[CALC] Dealer posture: γ short · net GEX ... · nearest wall ... (GEX · <timestamp>)` evidence line
matching their own prose — confirming the drop is conditional on `gammaPosture` resolving to null,
not a universal CLOSED-bucket omission. Confirmed in source (not just inference from the live
repro): `resolveGammaPosture`'s own `if (gex?.gamma_posture == null) return null;` guard, and
`buildGexRegime`'s `posture` derivation, both read directly off `main`.

**Blast radius:** one function, one evidence item — `evidenceFromContext` has no other call site
building this item, and no other consumer of `envelope.evidence` duplicates this derivation
(grepped the repo for other `Dealer posture:` producers; only `gexPostureSection`'s
narrative-markdown sibling exists, and it was already correct).

**Fix rationale:** decoupled the net-GEX/nearest-wall computation from the `if (gammaPosture)` gate.
`parts` now starts empty and only gets `γ ${gammaPosture}` pushed when `gammaPosture` is non-null —
mirroring how `gexPostureSection` already treats its own posture line as one optional line among
several independent ones, not a gate on the whole section. The evidence item itself is now pushed
whenever `parts.length > 0` (posture, net GEX, or nearest wall/flip — any one of the three), so the
old silent-omission behavior (Largo C6: omit, never fabricate) is preserved exactly for the case
where ALL THREE are absent (gex missing/stale and no vector fallback), while no longer collapsing
"posture unresolved" into "nothing to report." Deliberately left unchanged: the provenance/source
tagging logic (`sourceIsVector`/`netGexFromGex`), the Vector-preferred wall/flip precedence, and the
false-zero-safe `formatDealerDollars` formatting — none of those are implicated by this bug.

**Companion finding:** this shares its root cause (a null `gamma_posture`/`flip` while other GEX
fields are live) with `2026-10-26-swing-gex-flip-absence-closed-gate.md`, filed and fixed in the
same PR — see that file for why both were addressed together.

**Test:** `play-brief.test.ts` — two new regression tests: (1)
`composeSwingPlayBrief: Dealer posture evidence still surfaces net GEX/nearest wall when
gamma_posture itself is unresolved (Largo, live repro MRNA)` — a CLOSED play with
`gamma_posture: null`, `flip: null`, live `net_gex`/`call_wall`/`put_wall`, asserts the evidence
item exists, omits the `γ` token, and still carries "net GEX" and "nearest wall"; (2)
`composeSwingPlayBrief: Dealer posture evidence omits cleanly when gamma_posture, net GEX, and
nearest wall all fail to resolve` — a sibling control proving the old silent-omission behavior still
holds when there is genuinely nothing to report. Verified RED→GREEN via `git stash` on the source
fix alone (new test 1 fails pre-fix: `fail 1` out of 184 in `play-brief.test.ts`; both pass with the
fix restored). Full `play-brief.test.ts`: 186/186 pass. `src/lib/swing/*.test.ts` (whole directory):
2135/2135 pass. `tsc --noEmit`: clean.
