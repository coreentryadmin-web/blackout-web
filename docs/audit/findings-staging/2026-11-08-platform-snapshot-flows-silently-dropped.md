> **kind:** FINDING

## `get_platform_snapshot` silently dropped the ENTIRE flow tape — a shape mismatch, not a cap overrun — FIXED

| **Status** | FIXED |
|---|---|

**Where:** `src/lib/largo/platform-snapshot-fit.ts` (`fitPlatformSnapshotForModel`), the Largo
transport-fitting layer behind the `get_platform_snapshot` tool (`src/lib/largo/run-tool.ts:1319`).

### Root cause

`getPlatformSnapshot()` (`src/lib/platform/index.ts`) assigns `snapshot.flows` from
`flows.getFlowTapeSummary(...)`, whose return type is `FlowTapeSummary` —
`{as_of, session_date, count, total_premium, top_tickers, recent, strike_stacks, window_hours?,
pull_skew?}` per `src/lib/platform/types.ts`. It is an **object**, never a bare array; the actual
print rows live one level down, under `.recent`.

`fitPlatformSnapshotForModel`'s flow-capping block checked only:

```ts
if (raw.flows && Array.isArray(raw.flows)) {
  fitted.flows = raw.flows.slice(0, flowLimitForModel);
  ...
}
```

`Array.isArray(raw.flows)` is `false` for the real `FlowTapeSummary` object every production call
actually passes — so this branch never ran in production, and because there was no `else`
branch at all, **no `flows` key was ever written to `fitted`.** The Largo tool
`get_platform_snapshot` therefore always returned the flow tape as entirely absent — not
truncated, not capped, just missing — with no `flows_shown`/`flows_truncated` signal to tell the
model anything had been omitted. A model asking this tool for cross-product flow context (its
whole reason to include `"flows"` in the default `include` set) got nothing, every single call,
since this fitter was introduced in #3155.

This is the exact "shape mismatch between what a fitter expects and what the real producer
returns" failure the sibling `flow-tape-fit.ts` (`get_flow_tape`'s own fitter) already handles
correctly — it destructures `raw.recent` off the same `FlowTapeSummary` shape. The two fitters
simply drifted out of sync: one knows the real shape, the other assumed a shape that was never
true in production.

### Evidence (RED → GREEN)

Added `src/lib/largo/platform-snapshot-fit.test.ts` fixtures shaped exactly like the real
`FlowTapeSummary` (object with `.recent`, `.session_date`, `.total_premium`, `.top_tickers`,
`.pull_skew`, etc. — not a bare array, unlike every pre-existing test in this file).

- **RED** (pre-fix code, real-shape fixture): `"flows" in fitted` → `false`. `fitted` came back
  with only `nighthawk`/`spx` keys even with 50 real flow rows supplied.
- **GREEN** (post-fix): `"flows" in fitted` → `true`, `.recent` capped to `flowLimitForModel`
  (20), `flows_shown`/`flows_truncated` correctly set, and `session_date`/`total_premium`/
  `top_tickers`/`pull_skew` all survive the cap untouched beside the trimmed `.recent`.

Full file: `9 pass / 0 fail` (6 pre-existing + 3 new). `tsc --noEmit` clean project-wide.

### Blast radius

`fitPlatformSnapshotForModel` has exactly one call site (`run-tool.ts`'s `get_platform_snapshot`
tool case) — no other consumer is affected. Product consumers (`hunt-builder.ts`,
`bie/full-platform-snapshot.ts`, `bie/platform-context.ts`, the `/api/market/platform/snapshot`
route) call `getPlatformSnapshot()` directly without this fitter and were never affected — this
was a Largo-tool-transport-only bug, not a product-data bug.

### Fix rationale

Added an object-shape branch (`Array.isArray(raw.flows.recent)`) checked **before** the bare-array
branch, since a `FlowTapeSummary` object would also satisfy neither branch if checked in the
wrong order with a loose truthy check. Destructures `.recent` off, caps it to
`flowLimitForModel`, and re-attaches it beside the untouched aggregate/skew/session-anchor
fields — mirroring `flow-tape-fit.ts`'s own `{ ...meta, recent: kept }` pattern rather than
inventing a second convention. The bare-array branch is kept (not removed) so any caller/test
that passes a plain array directly still works, since nothing in the existing test suite or any
other call site required removing it.

The existing "fit `spx` LAST, against whatever budget remains" invariant (the #6132/#3159 fix)
is preserved: the real flows object is now written into `fitted` before `reserved =
JSON.stringify(fitted).length` is measured, so `spx`'s remaining budget correctly accounts for
the now-present flow tape instead of being computed as if it were still absent. A new combined
test (`real spx+flows(FlowTapeSummary)+nighthawk combined still stays under the transport cap`)
confirms restoring `flows` does not reopen the prior cap-overrun bug.

### What was deliberately left unchanged

Did not touch `getPlatformSnapshot()`, `FlowTapeSummary`, or `flow-tape-fit.ts` — all three are
already correct; the bug was entirely in this one fitter's shape assumption. Did not add a
`members_shown`/`members_truncated` implementation (those fields exist on
`PlatformSnapshotFittedResult` but nothing in this function ever set them, before or after this
fix) — unrelated to this bug and out of scope for a single-issue PR.
