> **kind:** FINDING

## `managementFor()` had no CLOSED branch — a closed position gets live "SELL"/"TRIM"/"HOLD" management guidance — FIXED

| **Status** | Fixed |
|---|---|

**Found by:** Ask Largo standing mandate (5-engine live monitor, Night Hawk Swings sub-mandate),
live spot-check on the swing play-brief for a real CLOSED position (`SWING:PANW:67`).

**Root cause:** `managementFor(exitModel, status, pnlPct)`
(`src/features/nighthawk/command-deck/adapters.ts`) special-cased `WATCH`/`SKIP` ("candidate
only, no position to manage") but had no branch for `status === "CLOSED"`. `DeckStatus` (`types.ts`)
includes `"CLOSED"` as a real value, so a closed row fell straight into the live P&L logic meant
for an *open* position:

```ts
const p = pnlPct ?? 0;
let recommendation: Recommendation = "HOLD";
if (status === "TRIM") recommendation = "TRIM";
else if (exitModel === "RATCHET" && p >= 90) recommendation = "TRIM";
else if (p <= -45) recommendation = "SELL";
```

For a CLOSED position this produced actively wrong, live-sounding guidance for a trade that no
longer exists:
- A CLOSED row that exited at a deep loss (`pnlPct <= -45`) showed **"SELL"** / *"Near the stop —
  the ratchet says cut and preserve capital."*
- A CLOSED RATCHET row that exited near its peak (`pnlPct >= 90`) showed **"TRIM"** / *"Bank a
  tranche and trail the runner..."* or *"Take partial into strength..."*
- Every other CLOSED row (the common case) showed a bare **"HOLD"** / *"Managing to the
  plan — hold while the thesis holds"* or *"...the thesis is intact"* — as if the position were
  still open and being actively managed.

**Live repro:** `SWING:PANW:67` (closed, `pnlPct: 10.03`) — `managementFor("<exitModel>", "CLOSED",
10.03)` returns the default `"HOLD"` / "Managing to the plan — hold while the thesis holds", which
is how it leaked into the swing play-brief's `briefContentKey` diff-cache snapshot
(`play-brief-diff.ts`'s `snapshotFromBrief` reads `play.recommendation` directly, which this
function stamps via `refreshSwingManagement`/`refreshZeroDteManagement`).

**Blast radius — every call site, not just the one that surfaced it:**
- `refreshSwingManagement`/`refreshZeroDteManagement` (adapters.ts) — stamp `play.recommendation`
  for every SWING/ZERO_DTE row, which is what the swing play-brief's diff-cache snapshot reads
  (the original symptom).
- `terminalPlayFromHorizon`'s 0DTE board-row adapter (adapters.ts ~line 515) — the recommendation
  badge shown on every row of the 0DTE board listing.
- `terminalPlayFromHorizon`'s swing board-row adapter (adapters.ts ~line 968) — same badge, Swing
  board listing.
- `PlayTerminal.tsx`'s `ManagePanel` (the Command Deck's "Management" tab, `[2]`) — renders for
  **every** `play.status` with no guard, so a member can click into a CLOSED position's card and
  see this exact live-sounding, wrong guidance directly in the UI.
- `ZeroDteCommandPanel.tsx` — same `managementFor` call for the 0DTE command panel.

**Fix:** add a `status === "CLOSED"` branch, same shape as the existing `WATCH`/`SKIP` special
case (structural `recommendation: "HOLD"` — `Recommendation` has no "closed" value and widening
that type is a bigger change, out of scope here — differentiated by an honest `recNote`):
`"Position closed — nothing left to manage."` This single fix point covers every call site above,
since they all go through this one function. **`progress` is still computed, not nulled** — an
earlier version of this fix nulled it unconditionally for CLOSED and broke a prior, deliberate fix
(PR #6619/#6625, task #106): `ZeroDteCommandPanel.tsx` feeds `managementFor` the *blended*
as-managed P&L for closed rows specifically so its RATCHET-track marker lands at the real outcome
(e.g. the historical +6.7% banked via trim-scale) rather than the raw mechanical −50% stop pin.
Caught by that panel's own regression test
(`ZeroDteCommandPanel.test.ts` — "verdict band + ratchet marker use the trim-scale as-managed
blend for a stopped CLOSED row") going red in CI on the first push; fixed by moving the
RATCHET-track `progress` computation above the CLOSED branch and returning it unchanged, so only
`recommendation`/`recNote` are overridden for CLOSED.

**Fix rationale:** matches the existing `WATCH`/`SKIP` pattern exactly rather than inventing a new
convention. Chose a fix at the shared function (the root) over patching each of the 5 call sites
separately, per this repo's own blast-radius discipline — a second/third independent CLOSED guard
at each call site would have been exactly the kind of drift this file's own `managementFor`
already exists to prevent for WATCH/SKIP.

**Evidence (RED → GREEN):** extended `adapters.test.ts` with a new test exercising all three P&L
extremes. RED (pre-fix, fix stashed): `managementFor("RATCHET", "CLOSED", -60).recommendation ===
"SELL"` (asserted `"HOLD"`, got `"SELL"` — confirmed the exact wrong-guidance bug). GREEN
(post-fix, corrected version — see the `progress` note above): same test (now also asserting
`progress` is `0`/`>0.9` for the two RATCHET cases and `null` for the SCALE_OUT case, matching the
preserved track-marker math), plus the full `adapters.test.ts` + `ZeroDteCommandPanel.test.ts`
run: 170/170 pass.
`npx tsc --noEmit`: clean.
