> **kind:** FINDING

# Swing TRIM latch ignored `verdict.enforced` — could silently disable the −60% premium_stop — FIXED

| **Status** | FIXED |
|------------|-------|
| **Pri** | P1 |
| **Area** | swing / active-refresh management engine |

## Symptom

`latchSwingLiveStatus()` (`src/lib/swing/manage-sync.ts`) flipped a swing position's ledger `status`
to `TRIM` whenever the management verdict's action was `TAKE_PARTIAL` or `EXIT_RUNNER` — with no
check of `verdict.enforced`. Those two actions are produced exclusively by EDGE rungs
(`profit_ladder`, `catalyst_shift`, `regime_shift`, `flow_decay`, `rel_strength_loss`,
`vol_collapse` — see `manage.ts`'s `GATING_RUNGS`/ENFORCE-vs-ADVISORY split; no capital-preservation
GATE rung ever returns `TAKE_PARTIAL`/`EXIT_RUNNER`), which stay advisory-only (`enforced: false`)
until the PR-16 calibration ladder graduates that specific rung. So an un-graduated 2× profit-ladder
recommendation — nothing the desk actually executed, no premium actually sold — still latched the
ledger row to `TRIM`.

That mattered beyond the status label: `planManageSync` derives `scaledAlready` from
`reads.scaledAlready === true || row.status === "TRIM"` on the very next refresh tick, and
`deriveScaleOutAction` (`zerodte/scale-out.ts`, shared with 0DTE/Banger) disables the −60%
`premium_stop` hard-stop check entirely once `scaledAlready` is true — it only re-arms the
trailing-stop rule for a runner that already banked a partial. So an un-enforced advisory
TAKE_PARTIAL could permanently disable the position's capital-preservation gate while the position
remained, in reality, 100% open and fully exposed to the full downside that gate exists to catch.

Found during a Swing V2 architecture-review pass
(`docs/audit/SWING-V2-DEEPDIVE-QUESTIONS-2026-09-05.md`, question #18), independently confirmed as a
real gap by Cursor's review of the same document.

## Root cause

`latchSwingLiveStatus(current, verdict)` checked only `verdict.action`, never `verdict.enforced`:

```ts
if (verdict.action === "TAKE_PARTIAL" || verdict.action === "EXIT_RUNNER") return "TRIM";
```

`verdict.enforced` already exists on `SwingManageVerdict` (`manage.ts`) specifically to distinguish a
capital-preservation GATE (always enforced) from an EDGE rung that is evidence-only until graduated
— but the one caller responsible for actually *acting* on that distinction (the live-status latch)
never read the field.

## Fix

`latchSwingLiveStatus` now requires `verdict.enforced` before latching TRIM:

```ts
if (verdict.enforced && (verdict.action === "TAKE_PARTIAL" || verdict.action === "EXIT_RUNNER")) return "TRIM";
```

An un-enforced TAKE_PARTIAL/EXIT_RUNNER now leaves `status` unchanged (stays `OPEN`/`HOLD`), so
`scaledAlready` correctly stays `false` on the next tick and the −60% `premium_stop` hard stop
remains live. No other branch of the function changes — HOLD/ADD promotion and the EXIT/STOP_OUT
current-status passthrough are untouched, and TRIM stays sticky once genuinely latched.

## Blast radius

Single call site (`manage-sync.ts`'s `planManageSync`) feeds the swing active-refresh cron
(`swing-active-refresh/route.ts`) — every open swing position's live-status latch runs through this
function each refresh tick. No other product (0DTE, Banger) shares this latch; `deriveScaleOutAction`
itself is shared but unchanged here — only the caller-supplied `scaledAlready` input changes.

## Evidence

- `src/lib/swing/active-refresh.test.ts`:
  - `planManageSync: GRADUATED TAKE_PARTIAL latches TRIM; TRIM row sets scaledAlready` — updated the
    pre-existing pinned test (which previously exercised the buggy default-enforced assumption) to
    pass `graduatedRungs: ["profit_ladder"]`, proving the fix still latches TRIM correctly on a
    genuinely graduated/enforced scale-out.
  - `planManageSync: UN-GRADUATED (advisory) TAKE_PARTIAL must NOT latch TRIM, and the −60% hard stop
    must stay live next tick` (new) — RED against the pre-fix source (confirmed via `git stash`):
    asserted `status === "OPEN"` after an un-graduated TAKE_PARTIAL, which the buggy code returned
    `"TRIM"` for. GREEN post-fix. The same test then re-feeds the resulting row through a second tick
    at a −60% mark and confirms `STOP_OUT`/`premium_stop` still fires.
- `src/lib/swing/active-refresh.test.ts` + `manage.test.ts` full files: 32/32 pass (Node 20).
- Full `npm test`: 12538/12538 pass, 0 fail. `npx tsc --noEmit`: clean.
