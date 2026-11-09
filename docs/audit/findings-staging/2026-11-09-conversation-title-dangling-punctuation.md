> **kind:** FINDING

## Largo conversation-history titles left dangling punctuation before the ellipsis (round 436) — FIXED

| **Status** | FIXED |
|---|---|

### Root cause

`src/features/largo/conversation-history.ts`'s `conversationTitle()` built the Largo terminal's
"conversation history" list label with its own inline truncation:

```ts
return clean.length > 60 ? `${clean.slice(0, 59).trimEnd()}…` : clean;
```

This is a hard character slice with no word-boundary backup and no trailing-punctuation strip
before the appended ellipsis. `src/lib/truncate-text.ts` exists specifically because this exact
defect shipped THREE times already and was consolidated into one shared helper — its own header
documents the live symptom: *"the live NVDA card's headline ended `…holding resistance….` — four
dots — because `headlineFromMarkdown` sliced at 89 characters, `trimEnd()`ed, and appended an
ellipsis on top of the sentence's own full stop. `x-content-humanize` had the same bug; only
`generic-extract`'s copy stripped the trailing punctuation first."*

`conversation-history.ts` was a FOURTH, independent copy of that same slice-then-ellipsis pattern
that was never migrated to the shared helper when the other three were consolidated — the classic
"a fix landed in one place but a duplicate implementation elsewhere never got it" shape (the same
shape as the `gex-matrix-delta.ts` / `gex-matrix-changes.ts` strike-index bug fixed in PR #7640
this same session).

### Evidence (RED → GREEN)

A 69-character question ending "...right now, exactly" — which the old `slice(0, 59)` cuts
immediately after the comma in "...right now," — reproduces the exact artifact the shared
helper's header calls out ("flow, …"):

```js
// OLD (buggy) conversationTitle:
"Why is the gamma flip holding as resistance here right now,…"
//                                                          ^^ dangling comma directly
//                                                             before the ellipsis

// Shared truncateText(clean, 60):
"Why is the gamma flip holding as resistance here right…"
// backs up to the word boundary and strips the trailing comma first
```

Regression test added to `src/features/largo/conversation-history.test.ts`
(`conversationTitle strips trailing punctuation before the ellipsis (round 436 regression)`):
- **RED** on the pre-fix code (`git stash` isolating just the source change): `AssertionError`,
  `title must not leave trailing punctuation dangling right before the ellipsis, got "Why is the
  gamma flip holding as resistance here right now,…"` — 1 failing / 4 passing.
- **GREEN** after the fix: 5/5 passing.

`npx tsc --noEmit -p .` clean on both touched files.

### Blast radius

Only one call site: `src/hooks/useLargoChat.ts:296` (`title: conversationTitle(title)`), used to
derive the label shown in the Largo terminal's persistent conversation-history sidebar
(`localStorage`-backed, BIE Master Spec §6). The function's input/output contract is unchanged
(string in, ≤60-char string out), so the caller needs no change. No other file reimplements this
same slice-then-ellipsis pattern under the `src/features/largo/` or `src/lib/largo/` trees — grepped
for `slice(0, ... - 1)` / bare `"…"` appends across `src/` and found no further un-migrated copies
beyond this one (the three the shared helper's own header already names are already migrated).

### Fix rationale

Route through the already-hardened, already-tested `truncateText(clean, 60)` (`src/lib/truncate-
text.ts`) instead of re-deriving a fifth variant of the same logic. This is strictly additive to
the fix's own stated purpose ("ONE TRUNCATION, USED EVERYWHERE TEXT IS CUT FOR DISPLAY") — it was
simply missed when the module was created because this call site lives in a different directory
(`src/features/largo/`, the terminal's client-side UI layer) from the three originally audited.
Deliberately left unchanged: the 60-character cap itself, the whitespace-collapsing/trim step
before truncation, and the empty-question → `"New conversation"` fallback — none of those were
part of the defect.
