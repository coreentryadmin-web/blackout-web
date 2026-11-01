> **kind:** FINDING

# Meridian earnings-report `best_play.structure` guarded the wrong sibling field (`put_wall` instead of `call_wall`)

| | |
|---|---|
| **Area** | Meridian — earnings report composite verdict (`best_play` hint) |
| **File** | `src/lib/meridian/meridian-earnings-report-core.ts` (`bestPlayHint`) |
| **Status** | Fixed |

## Root cause

In both bearish branches of `bestPlayHint` (the already-printed "Miss" branch and the pre-print
"Bearish lean" branch), the `structure` string displays `input.call_wall` —

```ts
structure:
  input.put_wall != null && Number.isFinite(input.call_wall ?? 0)
    ? `...below call wall ${input.call_wall?.toLocaleString() ?? "—"} · ${emLabel}`
    : `Reaction-trade put-side structures inside ${emLabel}`,
```

— but the branch condition guards on `input.put_wall != null`, a **different field of the same
shape** that is never actually displayed here. Two independent defects fall out of this single
mismatch:

1. **A real `call_wall` goes unshown whenever `put_wall` is absent.** If `call_wall` is present
   and finite but `put_wall` is `null`, the guard (`put_wall != null`) is false, so the branch
   falls through to the generic fallback — even though a real, known call-wall level was available
   to show.
2. **`Number.isFinite(input.call_wall ?? 0)` can never actually fail on a missing `call_wall`.**
   `null ?? 0` and `undefined ?? 0` both coerce to `0`, and `Number.isFinite(0)` is `true` — so this
   half of the condition does nothing to gate on `call_wall` being real. When `put_wall` is present
   but `call_wall` is `null`, the branch is entered anyway and renders the literal string
   `"...below call wall — ·..."` — a dangling em-dash placeholder presented as if it were a level.

Both defects are two faces of the same underlying mistake: the guard was written against the wrong
field. The sibling "Band" message two lines above it (`parts.push(\`Band ${put_wall}–${call_wall}\`)`)
correctly requires both fields because it displays both — this one displays only `call_wall` and
should have required (and only required) `call_wall`.

## Evidence (RED → GREEN)

Added three tests to `meridian-earnings-report-core.test.ts` exercising both the printed-miss and
pre-print bearish branches with each wall combination:

- `call_wall: 520, put_wall: null` → pre-fix: `"Put-side structures inside ~8% implied band"`
  (the real 520 call wall is silently dropped). Post-fix: `"...below call wall 520 · ~8% implied
  band"`.
- `call_wall: null, put_wall: 480` → pre-fix: `"Put-side or fade setups below call wall — ·
  ~8% implied band"` (a dangling `"call wall —"`, with no real level). Post-fix: falls back to
  `"Put-side structures inside ~8% implied band"` with no mention of "call wall".
- Same `call_wall: 520, put_wall: null` combination in the already-printed ("Miss — the reaction
  is the read now") branch — same bug, same fix.

Ran with `git stash push` isolating only the source fix (keeping the new tests) to get a clean
RED run against the original code (3 failures, exact messages above), then `git stash pop` to
confirm GREEN (15/15 pass). `npx tsc --noEmit` clean.

## Blast radius

`bestPlayHint` is called only from `buildMeridianEarningsReport` in the same file, which is called
from `src/lib/meridian/meridian-earnings-intel.ts` and rendered directly to members by
`src/features/meridian/components/MeridianEarningsReportPanel.tsx` (`best_play.structure`). No
other call sites. Both the printed and pre-print bearish branches shared the identical bug —
fixed in both.

## Fix rationale

Changed both bearish-branch guards from `input.put_wall != null && Number.isFinite(input.call_wall
?? 0)` to `input.call_wall != null && Number.isFinite(input.call_wall)` — gating on the field that
is actually displayed, with a real (not `?? 0`-masked) finiteness check, and dropped the now-dead
`?.toLocaleString() ?? "—"` fallback on the display expression since the guard already guarantees
`call_wall` is a real finite number whenever that branch of the template string is reached.
Left the bullish branches (`king_strike`) and the "Band" message untouched — both already guard on
exactly the field(s) they display.
