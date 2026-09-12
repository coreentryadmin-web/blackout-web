> **kind:** FINDING

## Raw NUL bytes silently corrupted three tracked source files — FIXED, new repo-hygiene guard added

| | |
|---|---|
| **Lane** | Night Hawk Swings (own file) + cross-lane blast radius (0DTE, audit tooling) |
| **File** | `src/lib/swing/play-brief-intel.ts`, `src/lib/zerodte/calibration.ts`, `scripts/audit/upstream-ws-probe.cjs`; new guard in `src/repo-hygiene.test.ts` |
| **Status** | FIXED (this PR) |

### Root cause

Found while auditing `play-brief-intel.ts` for the standing Ask Largo mandate: `grep`/`file` reported
the file as **binary**, not text. A byte-level scan (`readFileSync(path)` as a `Buffer`, no encoding)
found a single raw `\x00` (NUL) byte at offset 21804, inside a dedup-key template literal:

```ts
const key = `${a.anomaly_type}\x00${a.detail}`;   // intended: a plain space separator
```

introduced by PR #4799 (`git blame` confirms). Every editor, this session's own earlier `Read`/`Edit`
tool calls, and `git blame`'s own output all rendered the byte as ordinary-looking whitespace — the
only way to see it was a byte-level scan. The dedup logic itself did not break (V8 strings tolerate an
embedded NUL as any other code unit, so `Set`-based dedup on the resulting key still worked
correctly) — the damage is entirely to the file's byte-level cleanliness and to any text tool that
assumes source files contain no control bytes (plain `grep` without `-a` silently skips the file
entirely, which is a real, live blind spot for every future audit pass over this file).

### Blast radius

A repo-wide byte scan (every tracked `.ts`/`.tsx`/`.mjs`/`.cjs`/`.js`/`.jsx` file) found two more
instances of the exact same shape:

1. **`src/lib/zerodte/calibration.ts`** (0DTE lane, not swing) — identical pattern, a NUL byte where a
   plain space was clearly intended in a `(source, hash)` dedup key: `` `${source}\x00${hash}` ``.
   Same non-functional-but-corrupting shape as the swing instance. Fixed here rather than left broken,
   specifically because leaving it broken would make the new repo-wide hygiene test (below) fail on an
   unrelated file the moment it's added — see "Fix rationale."
2. **`scripts/audit/upstream-ws-probe.cjs`** — a *different* root cause, NOT a corruption: a
   control-character-stripping regex, `/[\x00-\x1f\x7f-\x9f]/g` (strip C0 + DEL + C1 controls),
   written with the raw literal bytes instead of the `\xHH` escape sequences. Regex character classes
   parse a literal control byte identically to its escaped form, so **this one was already 100%
   functionally correct** — rigorously verified by evaluating the actual regex literal from the file
   and testing all codepoints 0x00–0xA4: the matching set is byte-for-byte identical before and after
   rewriting it with explicit `\xHH` escapes. Fixed anyway, purely for the same tooling-hygiene reason
   (a `grep` without `-a` treats this file as binary too) — zero behavior change, proven by the
   matching-codepoint-set comparison.

### Fix

- `play-brief-intel.ts` / `calibration.ts`: replaced the stray NUL byte with the plainly-intended space
  character. No logic change — the dedup keys are semantically identical strings either way (space is
  a safe separator here: `anomaly_type`/`source` are structured enum-like values, never containing a
  space, so there is no realistic key-collision risk from switching the separator byte).
- `upstream-ws-probe.cjs`: rewrote the regex literal to use explicit `\x00-\x1f\x7f-\x9f` escapes.
  Verified byte-for-byte identical matching behavior (see Evidence below) — this is a pure
  readability/tooling fix, not a behavior change.
- New test, `src/repo-hygiene.test.ts` ("no tracked source file contains a raw NUL byte"): scans every
  tracked source file for an embedded NUL byte. Catches this exact class of bug — which has now struck
  independently at least twice in the same PR (#4799) — anywhere in the repo, present or future.

### Fix rationale

The 0DTE and audit-tooling instances are outside this session's own lane (Night Hawk Swings), but both
are included in this same PR rather than filed as separate follow-ups: the new repo-wide hygiene test
would otherwise immediately fail on `calibration.ts` (a real corruption, not a matter of taste) the
moment it merges, and `upstream-ws-probe.cjs`'s fix is a zero-risk, behavior-preserving rewrite bundled
for the same reason — leaving either broken would make the new guard useless as a merge gate. This
mirrors the PR write-up policy's blast-radius discipline: "duplicated logic in a second file counts —
fix and note all of them, not just the one you tripped over."

### Evidence of testing

- Repo-wide byte scan (before): 3 tracked files contained a raw NUL byte. (after): 0.
- `upstream-ws-probe.cjs` regex equivalence: evaluated the actual regex literal from the file via
  `eval()` and tested every codepoint 0x00–0xA4 against it, both before and after the rewrite — the
  matching codepoint sets are byte-for-byte identical (`0x00–0x1f`, `0x7f–0x9f`, nothing else).
- New hygiene test RED→GREEN proven via `git stash` (stashing the 3 file fixes reproduces the RED
  failure naming exactly the 3 affected files; restoring them returns GREEN).
- Full `src/repo-hygiene.test.ts` (6 tests), `src/lib/zerodte/calibration.test.ts`, and
  `src/lib/swing/play-brief-intel.test.ts` (142 tests combined): all pass, no regressions.
- `npx tsc --noEmit`: clean.
- Full `npm test` (Node 20): run alongside this fix.
