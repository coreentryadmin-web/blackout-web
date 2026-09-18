## Ask Largo swing WATCH brief never disclosed the entry-validity deadline while the setup was still live

> **kind:** `FINDING`

| | |
|---|---|
| **Area** | Ask Largo swing play-brief — `watchEntrySection` (`src/lib/swing/play-brief.ts`) |
| **Severity** | P3 (member-facing narrative gap — Largo Contract C1 "time" violation: a real, already-computed deadline was implicit rather than disclosed) |
| **Status** | FIXED — `fix/swing-watch-entry-deadline` |

### Root cause

`entry-enterability.ts`'s `evaluateSwingEntryEnterability` always computes the real entry-validity
deadline (`entryDeadlineMs`, via `entry-model.ts`'s sub-lane windows — real-NYSE-trading-day aware,
not raw calendar days) purely to derive a boolean (`expired: true/false`) for the `watchEntryExpired`
field. The concrete deadline timestamp was then discarded — only the boolean ever reached
`TerminalPlay` or the brief. A member watching a still-live WATCH position had no forward-looking
answer to "how much longer is this entry window good for" — the first they'd ever hear about the
deadline was the EXPIRED badge itself, after it had already passed. This is a direct
`docs/audit/LARGO-PRODUCT-CONTRACT.md` C1 ("time") violation: a real, computed fact about time
left implicit rather than disclosed. It mirrors the section's own existing "First flagged N days
ago" backward-looking line — this adds the missing forward-looking counterpart.

### Evidence

Verified in source, not speculation:
- `src/lib/swing/entry-enterability.ts`: `entryDeadlineMs(input)` (a pre-existing function) computed
  once per call, used only to decide the `expired` branch's return value — never attached to any of
  the other ~10 return branches, and never surfaced as its own field.
- `src/features/nighthawk/command-deck/adapters.ts:836`: `watchEntryExpired = swingEnterability?.expired === true`
  — confirms `swingEnterability` (the same `evaluateSwingEntryEnterability` call) is already computed
  and available at this call site, just never read for the deadline itself.
- Pre-fix, no field carried the resolved deadline anywhere in `TerminalPlay` or the play-brief
  pipeline.

### Blast radius

Single extraction site (`evaluateSwingEntryEnterability` in `entry-enterability.ts`), threaded
through the existing pipeline (`command-deck/adapters.ts`/`types.ts` → `play-brief.ts`'s
`watchEntrySection`). No other call site reads this data. Every WATCH swing candidate with a
resolvable entry deadline that has NOT yet expired was affected (the EXPIRED case already had its
own badge + `deadPlayReason` disclosure, unaffected).

### Fix rationale

Added `deadlineIso?: string | null` to `SwingEntryEnterability`, computed once and attached to
every return branch (not just the expired one) — honest null whenever neither `entryDeadline` nor a
resolvable `anchoredAt`+sub-lane fallback was supplied. Threaded through `TerminalPlay.entryDeadline`
and rendered in `watchEntrySection` as a new line, shown only when `!play.watchEntryExpired &&
play.entryDeadline` — while NOT already expired (the EXPIRED badge already owns that case) and only
when a real deadline resolved (never fabricated). Format: `"Entry window closes **<ET date>**
(**N days** left) — stale after that, wait for a fresh setup."`, days-left computed from the same
`readMs` clock the rest of the section already uses.

### Verification

- `npx tsx --experimental-test-module-mocks --test src/lib/swing/entry-enterability.test.ts src/lib/swing/play-brief.test.ts`
  — 92/92 pass. RED→GREEN independently confirmed: reverted only the source fix (kept the 6 new
  tests) — 4/92 failed exactly as expected, 88/92 unaffected. Reapplied the fix — 92/92 pass.
- `npx tsc --noEmit` — clean.
- Full `npm test` (Node 20) — 14613/14616 pass, 0 fail, 3 pre-existing skips.
