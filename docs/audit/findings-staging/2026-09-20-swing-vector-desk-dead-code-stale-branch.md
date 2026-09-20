> **kind:** FINDING

## Ask Largo swing play-brief `vectorDeskSection` carried an unreachable dead-code guard — PR TBD — fix/swing-vector-desk-dead-code-stale-branch — 2026-09-20

| | |
|---|---|
| **Status** | FIXED |
| **Severity** | P4 |
| **Area** | Swing / Ask Largo play-brief |

**What was found:** `vectorDeskSection`'s stale-Vector branch (`src/lib/swing/play-brief-intel.ts`) unconditionally pushes a `"**Last snapshot** ... may lag spot."` line, optionally pushes a `"Vector desk grade: ..."` line when `p.grade` is set, then checked `if (!lines.length) return null;` before returning the section. Because the first line is pushed unconditionally *before* that check, `lines.length >= 1` always holds by the time the guard runs — the `return null` branch can never execute. This is not a correctness bug (no wrong output was ever produced; the section always rendered the staleness disclosure as intended) but is a genuine code-clarity defect: a guard that reads as if a real "nothing to show" path exists when none does, which can mislead a future reader (or a future edit built on the false assumption that this branch can return null).

**Why this wasn't caught by existing tests:** both existing stale-branch tests (`"stale Vector play.bias must not badge..."`, `"future-skewed Vector dataAgeMs..."`) construct fixtures with `play.grade: "A"` set, so neither exercised the `p.grade` falsy case — the one combination that would (if the guard were ever reachable) have hit it.

**What changed:** removed the dead `if (!lines.length) return null;` guard, replaced with a comment explaining why it was safe to remove (traced to the unconditional push a few lines above). Added a new regression test covering the previously-untested stale-with-no-grade combination, asserting the section still renders (never null) and omits the grade line — locking in the real, and only ever possible, behavior.

**Evidence — behavior-neutral, disclosed honestly:** this is dead-code removal, not a behavioral bug fix, so the usual RED→GREEN proof does not apply in the traditional sense — the new test passes identically with the guard present or removed (verified via `git stash`: 172/172 pass both ways). The value of the change is code clarity (removing a misleading always-false condition) and the new test locking in real coverage of a previously-untested input combination, not a corrected output.
- Full suite: `npm test` → 14905 pass / 0 fail / 3 skipped (pre-existing, unrelated).
- `npx tsc --noEmit` → clean.

**Blast radius:** Single guard removed from one branch of one function. No other call site or section touched.
