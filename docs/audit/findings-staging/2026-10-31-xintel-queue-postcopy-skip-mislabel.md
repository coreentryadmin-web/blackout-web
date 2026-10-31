> **kind:** FINDING

## `AdminXIntelQueuePanel.tsx` renders a REVIEW row missing copy as if the pipeline had SKIPPED — FIXED

**Status:** Fixed in this PR (`fix/xintel-queue-postcopy-skip-mislabel`).

### Root cause

`PackageCard` decided which post-copy block to render purely off `row.post_copy` truthiness:

```tsx
{row.post_copy ? (
  <div>... Post copy — paste as-is ...</div>
) : (
  // "A SKIP row is a decision, not a hole..."
  <div>
    {row.skip_kind === "BLIND"
      ? "Skipped — could not read the platform"
      : row.skip_kind === "MARKET_CLOSED"
        ? "Skipped — market closed"
        : "No high-value post this hour"}
  </div>
)}
```

The component already defines `const isSkip = row.status === "SKIP"` and uses it correctly for
every other SKIP-vs-not branch in the file (the `attachments` chip, the `GlassPanel` accent, the
"Why this one" block). This one place used `row.post_copy` as a proxy for "is this a skip" instead
— and that proxy is wrong, because `row.post_copy` can legitimately be `null` on a row that is
**not** a SKIP.

`src/lib/x-intel/queue-store.ts`'s `saveQueueRow()` is explicit about why:

> "`saveQueueRow()` downgrades a package that fails `readyBlockReason()` from READY to REVIEW
> rather than throwing: an hourly cron that crashes on a marginal package produces no row at all...
> Downgrading keeps the package, keeps the reason, and puts it in front of a human."

One of `readyBlockReason`'s own checks (`src/lib/x-intel/queue-types.ts`) is:

```ts
if (!row.post_copy || !row.post_copy.trim()) {
  return "READY requires post_copy — there is nothing for a reviewer to paste";
}
```

So a draft that was selected as a real candidate (non-null `reason_selected`, real
`attachments`/`underlying_evidence`) but whose copy step produced nothing yet fails this one gate,
gets written with `status: "REVIEW"` and `post_copy: null` — a real, reachable row shape, not a
hypothetical one. The panel then rendered that REVIEW row with the SKIP-flavored header ("No
high-value post this hour", or worse "Skipped — could not read the platform" if a stale
`skip_kind` happened to survive), directly contradicting its own `reason_selected` text shown one
line below and claiming the cycle produced nothing when it actually picked a story that's simply
not copy-complete yet.

This is the exact "absence mislabeled as a different kind of absence" failure class this file's
own design-rule comments (and the sibling fixes `shouldShowXIntelFixtures`/#6075/#6792,
`readyBlockReason`'s BLIND-vs-QUIET split) explicitly exist to prevent — it just reached a corner
those two previous fixes didn't cover.

### Evidence

RED→GREEN, `src/components/admin/AdminXIntelQueuePanel.test.tsx`:
- Before the fix, the new `xIntelPostCopyDisplay` export does not exist — importing it fails
  (`TypeError: ... is not a function`), 7/7 new tests fail.
- After the fix, 7/7 pass, including the two REGRESSION cases that directly reproduce the
  downgrade shape: a `{status: "REVIEW", post_copy: null, skip_kind: null}` row (the real
  `saveQueueRow` downgrade shape) and a `{status: "REVIEW", post_copy: null, skip_kind: "BLIND"}`
  row (proving `status`, not a stale `skip_kind`, must gate the branch).
- Full x-intel test surface (`AdminXIntelQueuePanel.test.tsx`, the two `x-intel-queue-*` guard
  tests, `queue-status-counts.test.ts`, `queue-fixtures-gate.test.ts`, every `src/lib/x-intel/*.test.ts`)
  stays green: 238/238.
- `tsc --noEmit` clean. `eslint` on the changed file: 0 new errors/warnings (one pre-existing,
  unrelated `react-hooks/exhaustive-deps` warning on the `display`/`useMemo` line, present before
  this change too).

### Blast radius

Only `AdminXIntelQueuePanel.tsx` renders `XIntelQueueRow`s — there is no second consumer of this
shape to fix. `queue-store.ts`/`queue-types.ts` are untouched; the downgrade behavior they
describe is correct and intentional, this fix only corrects how the admin surface *displays* one
of its reachable outputs.

### Fix rationale

Extracted the branch decision into a small pure function, `xIntelPostCopyDisplay(row)`, returning
a discriminated union (`"post_copy" | "skip" | "awaiting_copy"`) gated on `row.status`, matching
every other `isSkip`-based branch already in this file — rather than patching the existing ternary
in place, which would have left the SKIP-wording derivation inline and hard to unit-test (this
repo's existing convention, e.g. `DarkPoolPanel.test.tsx`/`fmtShares`, is a small exported pure
helper the component calls). A third `"awaiting_copy"` state was added rather than collapsing it
into either existing branch — a REVIEW row with no copy yet is neither "ready to paste" nor "the
pipeline skipped this cycle," and conflating it with either would reproduce the same mislabeling
this fix removes, one level up.
