## 2026-09-16 — [FINDING, FIXED] Legacy option-mark row's last-resort fallback bypassed midOf's own crossed-book guard

> **kind:** `FINDING`

| Field | Value |
|---|---|
| **Status** | FIXED |
| **Severity** | P3 |
| **Lane** | Night Hawk Legacy |
| **File** | `src/features/nighthawk/lib/legacy-option-mark-row.ts`, `src/lib/providers/options-snapshot.ts` |
| **PR** | (this branch) |

### Root cause

`buildLegacyOptionMarkRow` (`legacy-option-mark-row.ts`) — the shared WS/REST mark-assembly
function behind the Legacy marks API route and server live-sync, extensively hardened this month
against backstop-quote divergence (2026-09-13/09-14/09-15 fixes, all documented in this file's own
header comment) — had one remaining unguarded path:

```ts
const mark =
  wsMark ?? snapMark ?? (bid != null && ask != null ? (bid + ask) / 2 : bid ?? ask ?? null);
```

`wsMark`/`snapMark` are both `null` only when the underlying WS/REST payload's own `mark` field is
`null` in the first place (`reliableMarkFromQuote` returns `null` only via `if (mark == null) return
null;` — on a detected divergence it substitutes the honest reference price, never `null`). Per
`mapUnifiedSnapshotResult`'s own mark ladder (`midOf(bid,ask) ?? last ?? dayClose`), a `snap.mark`
of `null` means `midOf(bid,ask)` **already rejected** the bid/ask pair — a crossed book (`ask <
bid`), `ask <= 0`, or similar — and there is also no last trade or day-close available. In exactly
that case, this file's own final fallback recomputed a raw `(bid + ask) / 2` average with none of
`midOf`'s validity checks, reconstructing the same fabricated mid `midOf` had just refused to
produce — the identical failure shape (`midOf`'s own header comment: "a stale/glitched print must
not synthesize a fabricated mid") this file was otherwise carefully guarded against.

### Evidence

RED→GREEN proven in `legacy-option-mark-row.test.ts`: a snapshot with `mark: null, bid: 5, ask: 3`
(a crossed book with no last trade or day-close — exactly what `midOf(5, 3)` rejects, since
`ask >= bid` fails) previously produced `row.mark === 4` (the raw average of an invalid pairing).
Reverting the fix alone reproduces that value; the fix produces `row.mark === 5` (falls to the
single real quoted `bid` value instead of averaging two numbers `midOf` itself rejected).

### Blast radius

`legacy-option-mark-row.ts`'s `buildLegacyOptionMarkRow` is the only caller of the changed fallback
line. `midOf` itself is unchanged — only exported (was previously private to
`options-snapshot.ts`) so this file could reuse it instead of reimplementing the arithmetic inline.
Grepped every other importer of `options-snapshot.ts` (`swing-active-refresh`, `banger-live-sync`,
`legacy-marks` route, `vector/contract-picks/live`, `option-chain-prompt.ts`,
`legacy-option-marks-server.ts`, `zerodte/live-marks.ts`, `zerodte/thesis/contract-attach.ts`,
`zerodte/scan.ts`, `vector-pick-sweep.ts`) — none reference `midOf` by name, so exporting it changes
nothing for any other caller.

### Fix rationale

Delegate to the shared, already-tested `midOf` instead of reimplementing its arithmetic inline —
the same pattern this file already follows for `isZeroDteMarkStale` (its own comment: "delegates to
the shared … predicate … instead of reimplementing the age check inline — the inline copy
previously carried its own … gap independently of the shared one"). `midOf(bid, ask) ?? bid ?? ask
?? null` replaces the raw average: a crossed/invalid pair now correctly falls to a single real
quoted value rather than an average `midOf` itself would reject.

### Regression test

`src/features/nighthawk/lib/legacy-option-mark-row.test.ts` — new test constructs a snapshot with a
crossed book and no mark/last/dayClose anywhere, asserting the row falls to `bid` rather than a
fabricated average. RED→GREEN proven via git-stash: 9 pass / 1 fail with the fix reverted; 10/10
pass restored.
