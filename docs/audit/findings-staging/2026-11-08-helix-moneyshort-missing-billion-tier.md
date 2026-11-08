> **kind:** FINDING

## HELIX `moneyShort` had no "B" (billion) tier at all — overflowed to a 4+ digit "M" label — FIXED

| | |
|---|---|
| **Area** | HELIX → Discord community alerts (`src/lib/helix-discord-format.ts`'s `moneyShort`) |
| **Status** | FIXED |
| **Files** | `src/lib/helix-discord-format.ts`, `src/lib/helix-discord-format.test.ts` |

### Root cause

`moneyShort(n)` (the shared dollar-figure formatter for every HELIX Discord embed — live flow
pings, the 15m/30m digests, burst collapses, the EOD session recap, and — via re-export — every
dark-pool Discord alert in `darkpool-discord-format.ts`) only ever had two scale branches: `K`
(`>= 1e3`) and `M` (`>= 1e6`). There was **no branch at all for values `>= 1e9`** — the function
simply fell into the `M` branch forever, however large `n` got:

```ts
if (Math.abs(n) >= 1e6) {
  const v = n / 1e6;
  return `$${v >= 10 ? v.toFixed(1) : v.toFixed(2)}M`;
}
```

`moneyShort(1_234_567_890)` rendered `"$1234.57M"` instead of `"$1.23B"` — not a misrounded digit,
a wrong *scale* on the number, which reads as "one thousand two hundred thirty four million" to
anyone parsing it, rather than "one point two billion".

This is a **different defect from the already-fixed K→M boundary-rounding bug** (PR #6727,
2026-10-25, which taught this same function to promote a value whose *K*-quotient rounds to 1000
into `M` instead of printing `"$1,000K"`). That fix only ever touched the `[999_500, 1_000_000)`
sliver at the K/M boundary — it left the `M` branch itself completely untouched, with no upper
bound and no promotion logic of its own. The bug this PR fixes is not a boundary artifact at
all: it is a **wholesale missing scale tier**, reachable by *every* value from $1B upward, not
just a thin band near a tie point.

### Evidence

Every sibling money-formatter in this exact codebase already has a `B` tier — several have `T`
too — confirming `moneyShort` was the outlier, not the norm:

- `src/lib/fmt-money.ts` — `if (abs >= 1_000_000_000) return ...B`
- `src/features/helix/lib/helix-contract-notional-format.ts` — same, `B` tier
- `src/features/helix/lib/helix-tide-money-format.ts` — same, `B` tier (the exact sibling HELIX
  formatter this fix's shape mirrors)
- `src/features/meridian/lib/meridian-revenue-format.ts`, `src/features/vector/lib/vector-crosshair-format.ts`,
  `src/features/thermal/lib/gex-heatmap-money-format.ts`, `src/lib/swing/format-nonzero.ts` — all
  have `B` (the last two also have `T`)

And the gap is **routinely reachable in production**, not a theoretical corner case:
`discord-eod-recap.ts`'s `buildHelixEodRecapEmbed` sums `premium` across every qualifying flow
for the WHOLE session (`src/app/api/cron/helix-discord-digest/route.ts` fetches up to `limit: 400`
rows, each `>= HELIX_DISCORD_MIN_PREMIUM` = $500K) and passes that sum straight to `moneyShort`.
400 rows at even a modest average premium clears $1B easily on a normal trading day — this is the
EOD recap's headline total premium figure, posted to Discord every single session day, not an
edge case.

RED→GREEN (`src/lib/helix-discord-format.test.ts`):
- Reverted `moneyShort` to its pre-fix body → two new test cases fail:
  - `moneyShort(1_234_567_890)` → actual `"$1234.57M"`, expected `"$1.23B"`
  - `moneyShort(999_950_000)` → actual `"$1000.0M"`, expected `"$1.00B"`
- Restored the fix → all 19 tests in the file pass (`npx tsx --experimental-test-module-mocks
  --test src/lib/helix-discord-format.test.ts`).
- Consumer tests unaffected: `discord-eod-recap.test.ts` + `darkpool-discord-format.test.ts`,
  27/27 pass (both import `moneyShort` transitively through `helix-discord-format.ts`).
- `npx tsc --noEmit` clean.

### Blast radius

`moneyShort` is imported directly by `src/lib/discord-eod-recap.ts` (HELIX + dark-pool EOD
session recap embeds) and `src/lib/darkpool-discord-format.ts` (per-block alerts, top-blocks
digest, burst embeds) — every one of those surfaces that can print a total/sum figure (session
premium total, dark-pool burst/digest notional) inherits the fix. Two owned-lane files
(`src/features/spx/lib/spx-play-terminal-lines.ts`, `src/features/spx/lib/spx-odte-intel-feed.ts`)
define their own LOCAL copy of `moneyShort` with the identical missing-`B`-tier shape — deliberately
left untouched here, same as PR #6727's own scoping note, since SPX-lane files are excluded from
this round's territory.

### Fix rationale

Added a `B` branch (`Math.abs(n) >= 1e9`) mirroring the existing `M` branch's own precision
convention (`toFixed(1)` at `>= 10`, `toFixed(2)` below) and matching the two closest HELIX
siblings (`helix-contract-notional-format.ts`, `helix-tide-money-format.ts`), neither of which
goes further than `B` — no `T` tier was added, since a dollar-premium Discord figure in this
product area has no realistic path to a trillion.

Adding the `B` branch alone would just relocate the exact same "round first, then check for
overflow" bug one tier up (an `M`-quotient of `999.95` rounds to `"1000.0"` at its own 1-decimal
display precision, which would render the literal `"$1000.0M"` again if left unguarded) — so the
`M` branch now computes its display string first and promotes to `B` when that string's numeric
value hits `1000`, the identical discipline the existing K→M guard immediately below it already
uses, and the same pattern every sibling formatter listed above applies at its own B/T boundary.
Left unchanged: the existing K→M guard (PR #6727) and the integer/non-finite short-circuits at
the top of the function.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01PzDkDzjR3bJQsFbXENzsVz
