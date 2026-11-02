> **kind:** FINDING

## 2026-11-02 — [FINDING, P2] `findings-merge-core.mjs` silently drops a one-sided edit to an existing FINDINGS.md entry — FIXED

| Field | Detail |
|---|---|
| **Component** | `scripts/audit/lib/findings-merge-core.mjs` (`resolveStages`), used by `scripts/audit/findings-merge-resolve.mjs` (the git merge driver for `docs/audit/FINDINGS.md` conflicts) |
| **Status** | FIXED |
| **Severity** | P2 — silently reverts a real content update (e.g. a finding's own `Status` column flipping OPEN → FIXED) with no error, no log line, and `ok: true` |

### Root cause

`resolveStages` computes three outcomes from the three merge stages (`base`, `ours`, `theirs`):
`added` (brand-new entries from `theirs`), `contested` (entries edited differently on *both*
sides — a real collision), and otherwise falls through to `const merged = [...added,
...o.entries]`.

That fallthrough is the bug: it unconditionally uses `ours`' copy of every pre-existing entry. The
`contested` filter only fires when **both** `ours` and `theirs` diverge from `base`
(`theirLines !== baseText.get(e.key) && ourLines !== baseText.get(e.key)`) — which is correct for
detecting a genuine two-sided collision, but it means the common one-sided case (`theirs` edited an
entry that `ours` left byte-identical to `base` — e.g. a different branch flips a finding's
`Status` cell from `OPEN` to `FIXED` after independently verifying the fix, while the branch being
folded in never touched that entry) is correctly recognised as *not a collision*, and then nothing
ever picks up `theirs`' edit. `merged` only ever contains `added` (new headings) plus `o.entries`
(the stale pre-edit copies), so the edit is discarded. The function returns `{ ok: true, added: [],
... }` — the exact shape `findings-merge-resolve.mjs` treats as "no new entries from theirs — kept
ours" (a clean success log), with no signal that an existing entry's content was dropped.

This is the inverse of ordinary three-way merge semantics (unchanged-on-one-side should take the
other side's change), and it is exactly the kind of damage the file's own "NO SILENT LOSS" check
(re-parsing the written text and asserting heading *count*) cannot catch — the heading count is
unaffected because no entry disappears, only its *content* reverts.

### Evidence

Minimal repro (see the added regression test, same scenario, run against the pre-fix code):

```js
const base   = heading + "| Status | OPEN |\n";
const ours   = base;                               // unchanged from base
const theirs = heading + "| Status | FIXED |\n";    // theirs flips the Status cell

resolveStages({ base, ours, theirs });
// pre-fix: { ok: true, added: [], text: "...| Status | OPEN |...", ... }
//          -> theirs' FIXED update is silently gone; reports as if nothing happened.
// post-fix: { ok: true, added: [], text: "...| Status | FIXED |...", ... }
```

`npx tsx --experimental-test-module-mocks --test scripts/audit/lib/findings-merge-core.test.mjs`
on the pre-fix code: 1 failing (`fast-forward edit from theirs is NOT silently dropped`), 4 passing.
Post-fix: 5/5 passing. Verified both ways via `git stash`/`git stash pop` on the one changed file.

### Blast radius

Single call site: `scripts/audit/findings-merge-resolve.mjs` is the only consumer of
`resolveStages`, invoked as the git merge driver whenever two branches both touch
`docs/audit/FINDINGS.md` (which, per this repo's own standing note, is *every* pair of concurrent
agent PRs, since every finding lands at the same anchor). Any merge where one branch edits an
existing entry's content (most plausibly a `Status` field moving OPEN → FIXED/WONTFIX, since new
findings are supposed to be staged separately per the issue-handling policy, but an in-place status
correction on an already-folded entry is a normal, expected edit) while the other branch is a
no-op on that entry would have silently regressed the status — and the CLI's own success message
("no new entries from theirs — kept ours") actively misreports it as a clean, uneventful merge.

### Fix rationale

Added one pass, immediately before building `merged`, that detects exactly this shape — `theirs`
changed an existing entry (`baseKeys.has` and `ourKeys.has` both true) whose `ours` copy is still
byte-identical to `base`, and `theirs`' copy differs from `base` — and swaps that entry's lines for
`theirs`' version when assembling `merged`. This mirrors standard three-way-merge semantics
("unchanged side takes the other side's change") exactly, and deliberately leaves every other
branch of the function untouched:
- the two-sided `contested` collision detection (unchanged — still refuses and asks for a human);
- the identical-edit-on-both-sides no-op case (unchanged — already correctly a no-op, now also
  correctly skipped by the new pass via the `ourLines === theirLines` early-continue, so it never
  does redundant work);
- `added` (new headings) and the "NO SILENT LOSS" heading-count re-parse (both unchanged).

No alternative fix (e.g. widening `contested` to flag this case too) was chosen, because this case
is not actually ambiguous — there is only one side's edit to take, so forcing a human to resolve a
non-collision would be the same kind of false alarm the file's own comment block (on the
identical-edit exception, just above) already explains the cost of.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01PzDkDzjR3bJQsFbXENzsVz
