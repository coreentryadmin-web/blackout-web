> **kind:** FINDING

# LULD WS timestamp normalizer shrinks a correct millisecond epoch by 1000x

| | |
|---|---|
| **Area** | `src/lib/providers/polygon-luld.ts` (Massive/Polygon stocks LULD WebSocket normalizer) |
| **Severity** | P3 — latent correctness bug on a field not currently load-bearing for gating, but corrupts the displayed/stored halt timestamp whenever it fires |
| **Status** | Fixed |

## Root cause

`normalizeLuldWsMessages` converts the raw `t`/`timestamp` field on a LULD WS frame to epoch
milliseconds via a nested ternary with two magnitude checks:

```ts
const ts =
  Number.isFinite(tsRaw) && tsRaw > 0
    ? tsRaw > 1e15
      ? Math.floor(tsRaw / 1_000_000)   // treated as nanoseconds
      : tsRaw > 1e12
        ? Math.floor(tsRaw / 1000)      // treated as "needs ÷1000"
        : tsRaw                          // kept as-is
    : now;
```

The second branch (`tsRaw > 1e12`) is backwards for the single most common real case: a **plain
millisecond epoch**, which today is itself ~1.7e12 — i.e. greater than 1e12. Any ms-scale
timestamp therefore falls into the "divide by 1000" branch and is silently shrunk into a
seconds-scale number (~1.7e9), a 1000x error.

This matters because Massive's own LULD docs (`https://massive.com/docs/stocks/ws_stocks_luld`)
literally document the `t` field as **"Unix MS"** — so a genuine millisecond value from `t`, or
from the `timestamp` fallback field name, is the *documented* case, not a hypothetical one. (Live
sample traffic observed in the docs is actually nanosecond-scale, which the `> 1e15` branch
already handles correctly — that mismatch is a separate, already-known doc-vs-wire quirk this repo
has hit before with other providers. The bug here is specifically that the function has no correct
branch for an **already-correct millisecond value**, which is exactly what the provider's own
documentation says to expect.)

Downstream, `luld-halts-store.ts`'s `applyLuldHaltEvents` builds the stored halt record directly
from this value:

```ts
halted_at: new Date(ev.ts).toISOString(),
```

A 1000x-shrunk `ts` makes `new Date(...)` construct a timestamp from January 1970 instead of the
real halt time — every `halted_at` field for a halt whose WS frame carried a plain-ms timestamp
would be wrong by roughly the age of the Unix epoch.

## Evidence (RED → GREEN)

Added a regression test asserting a realistic epoch-ms value (`1_718_000_000_000`, ~June 2024)
survives `normalizeLuldWsMessages` unchanged:

- **RED** (`git show origin/main:src/lib/providers/polygon-luld.ts` restored, fix reverted):
  ```
  not ok 3 - normalizeLuldWsMessages keeps an already-millisecond t unchanged
  expected: 1718000000000
  actual:   1718000000
  ```
  — reproduces the exact 1000x shrink.
- **GREEN** (fix restored): all 5 tests in `polygon-luld.test.ts` pass, plus the full
  `stocks-socket.test.ts` and `trading-halts-expiry.test.ts` suites (23/23) still pass unchanged.

## Blast radius

Only one call site reads this value downstream: `src/lib/ws/stocks-socket.ts` passes
`normalizeLuldWsMessages`'s output into `applyLuldHaltEvents` (`src/lib/ws/luld-halts-store.ts`),
which is the only place `ev.ts` is read (into `halted_at`). `active`/`indicator`/band-level fields
are untouched by this fix — only the timestamp conversion changes. No other provider/consumer
reads this normalizer's `ts` field.

## Fix rationale

Extracted the conversion into a small, pure, now-exported `luldMsFromRawTimestamp(tsRaw, now)`
helper with four correctly-ordered magnitude bands (seconds ~1e9, already-ms ~1e12, microseconds
~1e15, nanoseconds ~1e18), matching the same ns/ms disambiguation convention already used
elsewhere in this repo (`uw-socket.ts`'s `ts > 1e12 ? ts : ts * 1000`, which correctly treats an
already-ms value as needing no conversion — the exact behavior this fix restores here). Kept the
real, wire-verified nanosecond branch (`> 1e17`, tightened from the old `> 1e15` so it no longer
also swallows genuine microsecond values) since that is the format Massive's live traffic actually
uses today, despite its own docs claiming milliseconds. Non-finite/zero/negative inputs still fall
back to `now`, unchanged from the original behavior.

Not fixed/out of scope: nothing else in this file or its one caller needed a change — this is a
single, self-contained unit-conversion bug with one input and one output.
