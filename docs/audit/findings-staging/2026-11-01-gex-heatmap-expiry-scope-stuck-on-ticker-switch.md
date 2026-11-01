> **kind:** FINDING

## GEX Heatmap: per-expiry Key Levels default (nearest expiry) only ever resolves for the FIRST ticker, every later ticker switch is stuck on "All" — FIXED

| | |
|---|---|
| **Area** | Thermal / GEX Heatmap (`/heatmap`) |
| **File** | `src/features/thermal/components/GexHeatmap.tsx` |
| **Status** | Fixed |
| **Severity** | P2 — product/UX correctness regression, not data loss |

### Root cause

#2103 ("scope the whole Key Levels row to one expiry, defaulting to nearest") made
`expiryScope` resolve from the initial `"all"` to `expiries[0]` (the nearest real expiry on the
live axis) via a one-shot effect:

```tsx
const scopeResolvedRef = useRef(false);
useEffect(() => {
  if (expiries.length === 0) return;
  const isPreset = expiryScope === "near" || expiryScope === "monthly" || expiryScope === "0dte";
  if (!scopeResolvedRef.current && expiryScope === "all") {
    scopeResolvedRef.current = true;
    setExpiryScope(expiries[0]);
    return;
  }
  if (!isPreset && expiryScope !== "all" && !expiries.includes(expiryScope)) {
    setExpiryScope(expiries[0]);
  }
}, [expiries, expiryScope]);
```

`scopeResolvedRef` is a `useRef` — it survives for the component's entire lifetime, not just one
ticker. Separately, and predating #2103, an existing "Rank 5" effect resets `expiryScope` back to
`"all"` on every ticker change:

```tsx
useEffect(() => {
  lastForceAtRef.current = 0;
  setForceNonce(0);
  setFastFlash(false);
  setExpiryScope("all");
}, [ticker]);
```

Nobody reconciled the two: the ticker-reset effect put `expiryScope` back to `"all"`, but it never
cleared `scopeResolvedRef`. Once the FIRST ticker's resolution ran, `scopeResolvedRef.current`
stayed `true` forever, so the resolution effect's one-shot guard
(`!scopeResolvedRef.current && expiryScope === "all"`) could never fire again — the second branch
also does nothing for `expiryScope === "all"` (it only re-resolves a *stale concrete date* that
fell off the new axis, not the `"all"` sentinel itself). Net effect: the very first ticker a
member loads the heatmap with gets the intended per-expiry default (Key Levels/profile/curve
scoped to its nearest expiry); **every ticker switched to after that silently stays on the
unscoped near-term aggregate** — exactly the "two books at once" defect #2103 was written to
remove (Gamma Flip/Call Wall/Put Wall/Net GEX/King Node summing several settlement dates while Max
Pain reads a single one), just reintroduced one ticker switch later.

This wasn't caught earlier because the symptom is invisible without comparing a fresh page load
(first ticker, correct) against a ticker search/switch (every ticker after, silently wrong) — both
render a normal-looking Key Levels row; only the per-expiry audit math behind #2103 would catch
the aggregate-vs-single-expiry mismatch, and that audit only ever ran against the default ticker a
fresh session loads with.

### Evidence

Wrote `src/features/thermal/components/GexHeatmap-expiry-scope-ticker-switch.test.ts`, which
extracts BOTH real effect bodies verbatim from the component source (same technique as the
existing `GexHeatmap-darkpool-band.test.ts`) and replays them in the real order a ticker switch
fires them. RED (pre-fix, `git stash` on the component file only):

```
expiryScope: EVERY ticker switch resolves to its own nearest expiry, not just the first
+ actual - expected
  [
    '2026-11-03',
+   'all',
+   'all'
-   '2026-11-06',
-   '2026-11-07'
  ]
```

SPY (first ticker) correctly resolves to `2026-11-03`; NVDA and TSLA (every ticker switched to
after) are stuck on `"all"`. GREEN after the fix — all three resolve to their own nearest expiry.
11/11 on the full `GexHeatmap*.test.ts` set, 135/135 on the full `src/features/thermal` test
sweep, `tsc --noEmit` clean.

### Blast radius

Every tile/panel that reads `filteredLevels`/`selectedExpiries` downstream of `expiryScope`:
the Key Levels row (Gamma Flip, Call Wall, Put Wall, Net GEX, King Node, Max Pain), the Gamma
Profile bars, and the Cumulative Curve. All of these silently fall back to the unscoped near-term
aggregate for every ticker after the member's first one in a session — on a multi-expiry name this
is the same "mixed books" misread #2103 fixed, just scoped to "after the first ticker switch"
rather than "always." No server-side code is affected; this is purely client-side default-scope
state management. The matrix/profile/curve VIEWS are otherwise correct for whatever scope is
active — only the *default scope chosen after a switch* was wrong.

### Fix rationale

Minimal, targeted: reset `scopeResolvedRef.current = false` inside the existing ticker-switch
effect (the Rank-5 effect), right alongside the other per-ticker resets it already performs
(`lastForceAtRef`, `forceNonce`, `fastFlash`, `expiryScope`). This re-arms the one-shot guard for
the new ticker so the resolution effect's `"all" -> nearest expiry` branch fires again, exactly
mirroring what happens on first mount. `scopeResolvedRef`'s declaration was moved up next to
`expiryScope`'s own `useState` (it was previously declared ~400 lines later, right next to its
resolution effect) so the ticker-reset effect does not need a forward reference to a `const`
declared later in the same render.

Deliberately NOT changed: the resolution effect's own branching logic, the "stale concrete date"
re-resolution branch (handles the ET-rollover case, unrelated to this bug), or the Rank-5 effect's
reset-to-`"all"` semantics (still correct — it's the right transitional value before the
resolution effect runs again for the new ticker).

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01PzDkDzjR3bJQsFbXENzsVz
