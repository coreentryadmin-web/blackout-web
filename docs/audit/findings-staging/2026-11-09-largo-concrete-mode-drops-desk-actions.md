> **kind:** FINDING

## Largo "Concrete" (default) answer mode silently dropped desk-action buttons — FIXED

| | |
|---|---|
| **Area** | Ask Largo — `LargoAnswerMessage.tsx` |
| **Severity** | P2 (real functionality unreachable for the overwhelming majority of real answers) |
| **Status** | FIXED |
| **PR** | fix/largo-actions-concrete |

### Root cause

`LargoAnswerMessage` renders a Largo assistant turn through one of four branches depending on
`answerMode` ("concrete" vs "deep") and whether the answer's envelope clears an unrelated
`richEnough` bar:

1. `isConcrete` (answer mode = "concrete")
2. envelope present, `richEnough === true` (answer mode = "deep")
3. envelope present, `richEnough === false` (answer mode = "deep", fallback to `BieAnswer`)
4. no envelope at all (raw-markdown shim, fallback to `BieAnswer`)

The `actions` prop — desk deep-links such as `"Open Thermal at <flip strike>"` or
`"Add <ticker> to watchlist"`, built server-side by `buildLargoActions()`
(`src/lib/largo/largo-actions.ts`) and attached to **every** Largo turn in
`src/lib/largo-terminal.ts` (`const actions = buildLargoActions({ ticker: tickerHint, envelope,
compareCard });`, called unconditionally, independent of `depth`/`answerMode`) — was only ever
rendered via `<LargoActionsBar actions={actions} sessionId={sessionId} />` inside branch 2 above.
Branches 1, 3 and 4 destructured `actions`/`sessionId` as props (and even listed them in the
`useMemo` dependency array) but never rendered `<LargoActionsBar>` at all.

`"concrete"` is the product's own documented **default** answer mode:
- `LargoConcreteAnswer.tsx`'s own file header: *"Talon-style concrete read... no card chrome"*.
- `LargoNativeTerminal.tsx`: `answerMode={msg.depth === "deep" ? "deep" : "concrete"}` — concrete
  unless a member has explicitly switched to Deep dive.
- `largo-depth-mode.ts`'s `normalizeLargoDepth()` only returns `"deep"` on an exact match; every
  other value (including the legacy `"quick"` and anything unset) normalizes to `"concrete"`.

So for the overwhelming majority of real Largo answers — anything rendered in the default mode,
plus any Deep-dive answer whose envelope happens to miss the `richEnough` bar, plus the raw-
markdown shim path — the server computed real, actionable desk navigation (jump to the exact
Thermal strike referenced in the answer, or one-click add the discussed ticker to the watchlist)
on every single turn, and the client silently discarded it before it ever reached the member. The
member saw these buttons only by staying in Deep dive mode AND asking a question whose envelope
happened to clear the `richEnough` bar — the inverse of what a feature meant to be always-present
navigation should do.

This is the same shape as three bugs already fixed in this exact file/family this cycle
(`tradeDecision` gated behind Deep-dive-only in `LargoConcreteAnswer.tsx`; `envelope.structureLadder`
dropped by the Deep-dive branch; `sec.table` dropped by `LargoDeskRead`'s more commonly rendered
branch) — a computed field/widget that reaches the envelope on every turn, but is wired into only
one of several render branches that all claim to render "the answer".

### Evidence

Before the fix, a RED test (`LargoAnswerMessage.test.ts`, two new cases) rendered the component
in Concrete mode and in the not-rich-enough Deep-dive fallback, both with a non-empty `actions`
array, and asserted the rendered HTML contained `largo-actions-bar` / the action's label. Both
failed — the rendered HTML for Concrete mode was exactly the `LargoConcreteAnswer` markup with no
trace of the actions bar at all:

```
'<div class="largo-answer-with-panel">...<article class="largo-concrete-answer">...</article></div></div>'
```

(no `largo-actions-bar` anywhere). After the fix, the same input renders:

```
...<div class="largo-actions-bar" role="group" aria-label="Desk actions">
  <a href="/heatmap?ticker=AAPL&strike=150" class="largo-action-btn">Open Thermal at 150</a>
</div>
```

Full suite run for the touched directory (`src/features/largo/answer/*.test.ts` +
`src/features/largo/components/*.test.ts`): 138/138 pass post-fix.

### Blast radius

Only `src/features/largo/components/LargoAnswerMessage.tsx` needed a code change — `actions` and
`sessionId` were already threaded all the way through as props and already listed in the
`useMemo` dependency array (added for the `LargoDeskRead` branch's own `<LargoActionsBar>` call),
so no new wiring was needed elsewhere. `LargoActionsBar` itself (`LargoActionsBar.tsx`) already
no-ops cleanly on an empty/undefined `actions` array (`if (!actions?.length) return null;`), so
adding the call to the three previously-missing branches is a pure addition with no behavior
change when a turn genuinely has no actions to offer.

### Fix rationale

Added `<LargoActionsBar actions={actions} sessionId={sessionId} />` to the three branches that
were missing it (Concrete/default, Deep-dive-not-rich-enough, no-envelope raw-markdown shim),
mirroring exactly how the already-working Deep-dive+richEnough branch calls it. Left the
richEnough branch's own call untouched. Did not touch `LargoActionsBar.tsx` or
`buildLargoActions()` — both were already correct; the bug was purely a dropped render call in
one component, not a data-computation defect.
