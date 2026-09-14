> **kind:** FINDING

## Ask Largo's swing "Desk says TRIM"/"Manage plan" bullets called an already-crossed trim rail "next" — fix/swing-trim-rail-already-crossed-framing — 2026-09-14

| **Status** | FIXED |
|---|---|

### What was broken

Found during the standing Night Hawk Swings AGGRESSIVE MODE audit, live on CG's real committed position (`GET /api/market/swing/play-brief?playId=SWING:CG:25`): entry $2.60, mark $7.00, `pnlPct` **+169.2%**, `exitPolicy.trim_levels` a single unfired rung at `trigger_pct: 100`. Two separate bullets in the same brief both described that rail as forward-looking:

> **Desk says TRIM** — next rail at **+100%**. Bank partial into strength...

> **Manage plan** — manage engine **TAKE PARTIAL** · next trim at **+100%** (+100%) · ...

"Next" implies the rail is still ahead — something to watch for. It isn't: price has already run 69 points past it (169.2% vs a 100% trigger). The rail is *behind* current price, already cleared, and simply hasn't been manually banked yet (the whole product is advisory-only, per `managementFor`'s own "ADVISORY (we recommend, you execute)" comment in `adapters.ts`).

Root cause, two independent call sites with the identical shape:
- `actionNarrative`'s TRIM branch (`play-brief-narrative.ts:435`) — its own existing comment already states the invariant plainly: *"the trigger has already been crossed (that's why rec is TRIM at all)"* — but the bullet's wording was never revisited to say so.
- `manageLifecycleCoaching`'s trim-ladder-progress fragment (`play-brief-narrative-coaching.ts:113-114`) — the sibling bullet, same unfired-trigger lookup, same "next trim at +X%" phrasing.

### What changed

Both bullets now compare the unfired trigger's `trigger_pct` against the play's live `pnlPct` **at render time**, rather than assuming the invariant always holds from `recommendation`/`manageAction` alone:

```ts
const alreadyCrossed = typeof play.pnlPct === "number" && play.pnlPct >= next.trigger_pct;
```

This matters because `manageLifecycleCoaching`'s branch also fires for a plain `HOLD` play genuinely still building toward its first rail (pnlPct below the trigger) — that case must keep the honest, forward-looking "next trim at" wording, and the self-verifying check gets that right without needing to trust that `actionNarrative`'s narrower "always TRIM" invariant extends to every caller.

When `pnlPct` has already passed the trigger, both bullets now read `**+100%** rail already cleared, not yet banked` instead of `next rail at`/`next trim at`. A genuinely-still-ahead trigger, or an unavailable `pnlPct`, keeps the original wording untouched.

### Evidence

RED→GREEN (Node 20, `git stash` isolation, one file at a time): four new tests across `play-brief-narrative.test.ts` and `play-brief-narrative-coaching.test.ts` — an already-crossed case and a still-ahead case for each of the two bullets. All four failed pre-fix (missing the new "already cleared" copy or still containing "next rail"/"next trim at") and passed post-fix. Full targeted suites: 69/69 and 84/84 pass. `tsc --noEmit` clean.

### Blast radius

`actionNarrative` and `manageLifecycleCoaching` are each called from exactly one place in their own file (`tradeManagerNarrativeSection` / `collectCoachingBullets`), both feeding the swing play-brief's "Trade manager read" section only. No other consumer exists (checked via repo-wide grep). The genuinely-still-ahead path (pnlPct below trigger, or pnlPct unavailable) is byte-identical to before in both functions.

### Fix rationale

A self-verifying, data-driven check (compare live `pnlPct` to the trigger directly) was chosen over trusting `play-brief-narrative.ts`'s own comment that the invariant "always" holds when `rec === "TRIM"` — that comment could itself go stale, and `manageLifecycleCoaching`'s sibling branch demonstrably does NOT carry the same guarantee (it also fires for plain `HOLD`). Checking the actual data is more honest and self-correcting than propagating an assumption across two files, and costs nothing extra since `pnlPct` is already available on `TerminalPlay` at both call sites.
