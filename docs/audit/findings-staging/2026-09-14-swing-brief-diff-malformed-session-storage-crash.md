> **kind:** FINDING

## Ask Largo's live "what changed" diff engine could crash on a schema-stale sessionStorage snapshot — fix/swing-brief-diff-malformed-session-storage-crash — 2026-09-14

| **Status** | FIXED |
|---|---|

### What was broken

Found during the standing Night Hawk Swings AGGRESSIVE MODE audit while reading `play-brief-diff.ts` fresh (the "what changed since last read" engine behind `useSwingPlayBrief.ts`, not yet audited this session). `loadPersistedBriefSnapshot` hydrates the diff baseline from `sessionStorage` (so "Since last read" survives a remount) and validates only that the parsed object is non-null, is an object, and has a string `headline` — every other `BriefSnapshot` field is handed back unchecked and trusted as-is.

`diffBriefSnapshots` then reads `prev.sectionTitles.includes(t)` unconditionally, with no null guard (every other field access in that function is gated behind `!= null` checks — `sectionTitles` is the one exception). `sessionStorage` outlives a deploy: it is per-tab/per-session, not per-release, so a snapshot written under an older `BriefSnapshot` shape (a future field rename/removal) or corrupted by devtools/a browser extension survives across a code push. A stored object like `{ headline: "old schema" }` (missing `sectionTitles`) passes the existing validation, gets handed back as a real `prev`, and `diffBriefSnapshots({sectionTitles: undefined, ...}, next)` throws `TypeError: Cannot read properties of undefined (reading 'includes')` — uncaught, inside `useSwingPlayBrief`'s `useEffect` (no try/catch around the diff call), crashing that component's render tree.

Confirmed the throw directly (Node repro, isolated from the fix) before touching any code:
```
node -e '
function diff(prev, next) {
  if (!prev) return [];
  return next.sectionTitles.filter((t) => !prev.sectionTitles.includes(t));
}
diff({ headline: "x" }, { sectionTitles: ["A","B"] });
'
# THREW: Cannot read properties of undefined (reading 'includes')
```

### What changed

`loadPersistedBriefSnapshot`'s validation now also requires `Array.isArray(parsed.sectionTitles)`, rejecting (returning `null` — "no prior snapshot", the existing honest fallback) a stored object that doesn't carry a well-formed `sectionTitles`, exactly as it already rejects one with a non-string `headline`.

### Evidence

RED→GREEN (Node 20, `git stash` isolation): a new test writes a malformed `{ headline: "old schema" }` snapshot into a mocked `window.sessionStorage`, asserts `loadPersistedBriefSnapshot` now returns `null` instead of the malformed object (failed pre-fix — asserted `null`, got the raw object back — passed post-fix), and separately proves the crash this guards against by feeding that same malformed shape straight into `diffBriefSnapshots` and asserting it throws (so the fix can't be read as passing by coincidence). A sibling test confirms a well-formed, freshly-persisted snapshot still round-trips through `loadPersistedBriefSnapshot` unchanged. Full `play-brief-diff.test.ts` 23/23 pass, `tsc --noEmit` clean.

### Blast radius

`loadPersistedBriefSnapshot` has exactly one call site (`useSwingPlayBrief.ts`'s hydrate effect). No other consumer exists (repo-wide grep confirmed). The fix only changes behavior for an already-malformed stored value — a well-formed snapshot (the only shape `persistBriefSnapshot` itself ever writes today) is unaffected.

### Fix rationale

Extending the existing validation function (rather than adding a null-guard inside `diffBriefSnapshots` itself) keeps the fix at the actual trust boundary — the one place untrusted external data (browser storage, not a same-process value) enters the system — matching the function's own existing pattern of rejecting `headline` shape mismatches the same way. `diffBriefSnapshots` itself stays a pure function trusting its `BriefSnapshot` inputs are well-formed, which is true for every other call site (always built via `snapshotFromBrief`) and should stay true; the storage boundary is the one place that invariant could actually be violated.
