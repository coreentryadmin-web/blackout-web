> **kind:** `FINDING`

## Night Hawk Swings: whole-market discovery-pool gates loosened — FIXED

| Field | Value |
|-------|-------|
| **Status** | FIXED |
| **Area** | `src/lib/swing/v2/config.ts` (Tier-1 dynamic cap, flow-premium floors, Cortex preflight cap), `src/lib/swing/discovery.ts` (`maxStructureMovers`), `src/lib/swing/v2/origins/positioning-screen.ts`, `src/app/api/cron/swing-discovery/route.ts` (Vector-leader fetch limit), `src/lib/banger/discovery.ts` (BANGER-origin screen) |
| **PR** | (pending — `fix/loosen-swing-discovery-gates`) |

### Symptom

Same operator complaint as the companion 0DTE finding (`2026-09-08-nighthawk-0dte-discovery-gates-loosened.md`),
covering both engines in the same breath: *"0dte and swings should have had more plays... the
entire architecture on these 2 engines is broken."* This finding covers the swing-side discovery
pool — separate from, and shipped after, the persistence/corroboration gate already loosened
earlier this session (`2026-09-08-swing-persistence-loosened-standard-archetypes.md`). That fix
addressed how many DISCOVERED candidates get PROMOTED to WATCH; this one addresses how many
candidates ever get DISCOVERED and scored in the first place — a strictly upstream bottleneck.

### What changed and why

**The single biggest lever, by the pipeline's own structure:** `swingTier1CapCeiling` /
`swingTier1CapPoolPct` (`v2/config.ts`) directly controls how many merged Tier-0 names (across
FLOW, STRUCTURE, VECTOR, POSITIONING, BANGER, CATALYST origins) ever reach Tier-1 scoring/dossier
enrichment at all — every other gate (persistence, confluence, Cortex) only ever sees whatever
survives this cap. Raised ceiling 200→300 and pool pct 0.35→0.45 (mirrors the identical, already
evidence-backed reasoning behind the 0DTE `breakout-cap.ts` ceiling raise in the companion PR).

| Knob | File | Old → New |
|---|---|---|
| `swingTier1CapCeiling` / `swingTier1CapPoolPct` | `v2/config.ts` | 200/0.35 → 300/0.45 |
| `swingCorroboratedFlowMinPremium` | `v2/config.ts` | $150k → $100k |
| `swingLegacyFlowMinPremium` | `v2/config.ts` | $250k → $175k |
| `swingCortexPreflightCap` | `v2/config.ts` | 12 → 20 (hard ceiling 25 unchanged) |
| `maxStructureMovers` | `discovery.ts` | 40 → 60 |
| Vector-leader fetch `limit` (feeds POSITIONING + VECTOR origins) | `swing-discovery/route.ts` | 80 → 110 |
| `positioning-screen.ts` ticker slice | `positioning-screen.ts` | 60 → 90 (kept ≥ the wider Vector-leader fetch above so it isn't itself the new bottleneck) |
| `BREAKOUT_MIN_VOLUME` / `BREAKOUT_MIN_GAIN` (shared STRUCTURE screen, also used by 0DTE) | `candidates.ts` | 1M/3% → 750k/2% (same edit as the companion 0DTE PR — one shared file) |
| `DEFAULT_BANGER_SCREEN_CONFIG.minVol` / `.minGain` | `banger/discovery.ts` | 1M/5% → 750k/4% |

None of these carry the kind of direct, already-measured negative-EV evidence that stopped
certain 0DTE score floors from being touched (see the companion finding) — they are pure
candidate-pool breadth/floor numbers, not quality bars with their own backtest showing a specific
band loses money. `swingCortexPreflightCap` is capped at 25 regardless of the new default (20),
so raising it doesn't bypass the provider-budget ceiling, just uses more of the room already
allowed.

### Blast radius

- `positioning-screen.ts`'s slice cap had to move in lockstep with the Vector-leader fetch limit
  feeding it (both raised together) — the same trap `breakout-discovery.ts`'s header already
  documents for its own screen-pool/ceiling pair (a downstream cap smaller than an upstream one
  silently re-caps "qualifying" at the smaller number).
- `BREAKOUT_MIN_VOLUME`/`BREAKOUT_MIN_GAIN` in `candidates.ts` are genuinely shared with the 0DTE
  BREAKOUT screen — this is the one file edited in common with the companion 0DTE PR; both PRs'
  diffs on this file are identical, so whichever merges first, the other's diff on this specific
  hunk becomes a no-op (not a conflict — same change, same reasoning, same file).
- `tier1-cap.test.ts`'s `mid` scenario (`resolveSwingTier1Cap(200, 40, env)`) was pinned to the
  old `POOL_PCT` (0.35 → cap 80, floor-bound); updated to the new pool-pct math (0.45 → cap 90).

### Fix rationale

Same discipline as the companion 0DTE finding: every number here is a discovery-pool/floor knob
without its own measured negative-EV evidence attached, not a score band this desk has already
proven loses money. The dynamic Tier-1 cap ceiling/pool-pct is the highest-leverage single change
since it's structurally upstream of every other swing gate. Shipped per explicit operator
instruction to loosen aggressively and watch live outcomes rather than wait on a fresh backtest.

`npx tsc --noEmit` clean. Full suite green on Node 20 via `scripts/run-tests.mjs`: 13320/13320
pass, 3 pre-existing skips (same pass count as clean `main`, confirmed via `git stash` A/B).
