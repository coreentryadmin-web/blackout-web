> **kind:** FINDING

# UW `lit_trades` WS normalizer truncates `executed_at`, stripping precision/UTC marker — a documented fix never propagated to a sibling consumer

| | |
|---|---|
| **Area** | `src/lib/providers/unusual-whales.ts` — UW WebSocket normalizers |
| **Severity** | P3 (latent correctness defect on an exported, currently-unconsumed field; same defect class previously shipped as a real production bug on a sibling function) |
| **Status** | Fixed |

## Root cause

`normalizeLitTradesWsPayload` (parses UW's `lit_trades` / `lit_trades:TICKER` WS channel into
`UwLitTradePrint[]`) built its `executed_at` with:

```ts
executed_at: executedAt.slice(0, 19),
```

This is the **exact same defect** `normalizeOptionTradesWsPayload` — the function directly above
it in the same file, parsing the identical `r.executed_at ?? r.timestamp` shape off the same UW WS
transport — was explicitly fixed for. That fix's own in-code comment (still present, directly above
`normalizeOptionTradesWsPayload`'s `executed_at: executedAt,` line) spells out why the slice is
wrong:

> The slice was there to trim sub-second precision, but it destroyed two things instead. On an ISO
> string it strips the trailing `Z`: `"2026-06-30T15:04:00Z"` becomes `"2026-06-30T15:04:00"`,
> which ES parses as **LOCAL time**, not UTC — silently correct only because production runs UTC,
> and silently wrong the moment it does not. [...] Sub-second precision parses fine in both forms,
> so there was nothing to trim.

That fix (and the regression tests in `src/lib/flow-timestamp-epoch.test.ts`, e.g. "a Z-bearing
ISO string is NOT reinterpreted as local time") covers `normalizeOptionTradesWsPayload` only. The
sibling `normalizeLitTradesWsPayload`, added to the same file with the structurally identical
`String(r.executed_at ?? r.timestamp ?? "")` extraction, kept the `.slice(0, 19)` call — the fix
was never propagated to it. This is the same "fix shipped for one consumer of a shared data shape,
never applied to a sibling consumer of the identical shape" pattern already confirmed this round in
`vector-wall-rail-primitive.ts` (PR #7194, mid-CI at time of writing).

## Evidence

Confirmed live in `src/lib/providers/uw-ws-normalize.test.ts` before the fix:

```
test("normalizeLitTradesWsPayload keeps executed_at VERBATIM — does not strip the UTC 'Z'")
  Expected: '2026-06-30T15:04:00Z'
  Actual:   '2026-06-30T15:04:00'

test("normalizeLitTradesWsPayload keeps sub-second precision and the 'Z' on a long ISO timestamp")
  Expected: '2026-08-21T20:14:37.211537Z'
  Actual:   '2026-08-21T20:14:37'
```

Both RED before the fix (verified via `git stash` on the source change only, test file left in
place), both GREEN after removing `.slice(0, 19)` to match the already-fixed sibling. Full
`unusual-whales.test.ts` (34 tests) and `uw-ws-normalize.test.ts` (8 tests) pass clean after the
fix; `tsc --noEmit` clean.

A Z-stripped timestamp re-parsed with `new Date()`/`Date.parse()` on any host not running in UTC
(or any future code that constructs a `Date` from `UwLitTradePrint.executed_at`) would silently
read the print as having happened at a different wall-clock instant than it actually did — the
exact LOCAL-vs-UTC misinterpretation the sibling fix's own comment names as the motivating defect.

## Blast radius

- `normalizeLitTradesWsPayload` is the sole parser for the UW `lit_trades` WS channel
  (`src/lib/ws/uw-socket.ts`'s `pushLitTradeRows`, feeding `litTradesStore.rows`).
- Traced every current consumer of `litTradesStore.rows`: only `computeLitDarkRatio`
  (`src/lib/uw-lit-dark-ratio.ts`), which reads `.symbol` and `.premium` only — `.executed_at` is
  not consumed by any current call site. The field is otherwise write-only today, so this fix has
  **zero behavioral impact on any currently-shipped feature**.
- It IS part of the exported `UwLitTradePrint` type contract, and any future consumer that parses
  `.executed_at` as a timestamp (the obvious, expected use of a field named `executed_at`) would
  silently inherit the same local-time-misinterpretation defect the sibling function was
  specifically fixed to avoid. Fixing it now, consistent with the sibling, prevents that defect
  from being re-introduced the next time someone wires a new consumer off this struct.
- No other call site constructs a `UwLitTradePrint` outside this one normalizer function
  (confirmed via repo-wide grep for `UwLitTradePrint`).

## Fix rationale

Removed `.slice(0, 19)`, mirroring `normalizeOptionTradesWsPayload`'s already-shipped fix exactly,
and added an in-code comment on `normalizeLitTradesWsPayload` cross-referencing the sibling so a
future edit to one is prompted to check the other. Did not add any new defensive parsing logic
(e.g. routing through `extractUwTimestampFromRaw`/`flow-timestamp.ts`) — that machinery exists for
timestamps that get fed into `flowEventTimeMs`/`resolveFlowTimes` scoring, and lit-trade prints are
not persisted into that pipeline; the minimal, scoped fix is to stop destroying the raw value UW
sent, exactly matching what the sibling already does for the identical field shape. Extended
`uw-ws-normalize.test.ts` (the existing home for both normalizers' tests) with two new assertions:
one for the bare-`Z` case, one for microsecond-precision timestamps (the real shape UW sends,
captured live for the sibling's `created_at` field in `flow-timestamp-epoch.test.ts`).
