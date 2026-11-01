> **kind:** FINDING

## `src/lib/scan/cadence.ts` was dead code — never wired in, removed — FIXED

**Status:** FIXED (PR fix/remove-dead-scan-cadence)

### What was wrong

`src/lib/scan/cadence.ts` exported `scanCadence(etMinutes, isTradingDay)` and
`scanCadenceFromEt(hour, minute, isTradingDay)` — a pure function mapping the ET wall clock to a
scan-interval "floor" per session phase (`PRE_OPEN`/`OPENING_DRIVE`/`MORNING`/`MIDDAY`/
`POWER_HOUR`/`LATE`/`CLOSED`). It had **zero call sites anywhere in the repo** outside its own
test file (`src/lib/scan/cadence.test.ts`) — confirmed by grepping `src/` and `scripts/` for
`"scan/cadence"`, `"scanCadence("`, and `"scanCadenceFromEt"` in a fresh `origin/main` checkout.

### Root cause

The module was shipped by PR #1014 ("feat(scan): adaptive scan cadence — scan rate follows
information-arrival rate (design-review #4)") as explicitly PR 1 of 2. Its own commit message
says so directly:

> Follow-up (additive): read scanCadence in the warm-cron loop so the interval flexes by phase
> instead of a fixed 2 min.

That follow-up PR was never made. The module has sat fully unimported since, surviving 229 prior
audit rounds on this repo without anyone wiring it in or removing it.

### Blast radius

Nothing else references it, so removal has zero behavioral effect on any live cron or route.
Checked specifically: the `*-warm` crons this was meant to drive (`cron-registry.ts`) still run on
their own original fixed intervals, unaffected. The domain that most needed this exact idea —
swing discovery, whose thesis builds across sessions rather than seconds — has since grown its
own, more specific phase-anchored cadence module (`src/lib/swing/scan-cadence.ts`, PR-13,
`SwingDiscoveryPhase`-keyed, with session-day idempotency this generic module never had), which
superseded the generic concept for that cron family. The generic module was simply orphaned, not
silently relied upon.

### Fix rationale

Deleted `src/lib/scan/cadence.ts` and `src/lib/scan/cadence.test.ts` rather than leave an
unreachable "design" module that implies a wiring which doesn't exist (same dead-code-removal
pattern already established in this repo for orphaned exports — see #7139, #7040). An alternative
— actually wiring it into a warm-cron loop now — was considered and rejected for this pass: nearly
two years after design, the domain it targeted built its own superior, domain-specific
replacement, so completing the original follow-up would mean wiring a generic module into crons
that already have adequate fixed intervals, for benefit that was never measured.

### Evidence

- `grep -rn "scan/cadence\|scanCadenceFromEt\|scanCadence(" src scripts` (fresh `origin/main`
  checkout) → no hits outside the removed files, before the fix.
- `npx tsc --noEmit` → clean after removal.
- Both removed files' only consumer was each other (the module and its own test).
