> **kind:** FINDING

## Ask Largo swing play-brief — "Notable prints" strike rendered raw, inconsistent with every other level in the brief — FIXED

| **Status** | Fixed |
|---|---|

**Context:** Standing Ask Largo × Night Hawk Swings mandate (CLAUDE.md), cycle focused fresh on
LARGO-PRODUCT-CONTRACT.md's C9 (precision) point, which hadn't been the explicit focus of recent
cycles' write-ups.

**Root cause.** `flowIntelSection()`'s "Notable prints" list (`src/lib/swing/play-brief-intel.ts`,
`flowIntelSection`) rendered `p.strike` directly (`${p.strike ?? "—"}`) instead of `.toFixed(2)`.
`FlowRow.strike` (`src/lib/db.ts`) is a Postgres `NUMERIC` column round-tripped through
`Number(row.strike ?? 0)` — for an integer strike this renders identically either way ("235"), but
for a real fractional-strike contract (weekly options routinely strike at `.50`) it renders as
"232.5" — while every other level in the same brief (GEX king strike, dark-pool levels, nearest
wall, gamma magnet, confluence zones — all `.toFixed(2)`) renders "232.50" a line or two above/below
it. This is the exact class of thing C9 exists to prevent: precision must be consistent at the
presentation boundary, not ad hoc per call site.

**Why it wasn't caught earlier:** the only existing test for this section
(`flowIntelSection: the print list is labeled honestly...`, added 2026-09-18 for an unrelated fix —
the "Recent prints" mislabel) used a round integer strike (`350`) in its fixture, so the missing
`.toFixed(2)` was never exercised with a fractional value.

**Evidence (RED→GREEN):**
- Pre-fix: the 2026-09-18 test's own regex (`/CALL 350 \$3430000\.00/`, unformatted) passed; updating
  it to the correctly-rounded `/CALL 350\.00 .../` failed against the pre-fix source (RED), confirming
  the raw-render path.
- New test `flowIntelSection: notable-print strikes render to 2dp like every other strike in the
  brief (C9 precision)` — fixture strike `232.5` — RED pre-fix (`/PUT 232\.50 .../` fails against
  raw `232.5` output), GREEN post-fix.
- `src/lib/swing/play-brief-intel.test.ts`: 175/175 pass post-fix.
- `tsc --noEmit`: clean.

**Fix:** format `p.strike` with `.toFixed(2)` (guarded on `typeof === "number" && Number.isFinite`,
matching the guard style already used for every sibling level in this file), falling back to `—`
when absent — no behavior change for integer strikes, consistent formatting for fractional ones.

**Blast radius:** scoped to this one render site (`flowIntelSection`'s notable-prints bullet list).
No other call site in `play-brief-intel.ts` prints a raw strike — every sibling site already used
`.toFixed(2)` — confirmed by grep before and after.

**Not fixed / explicitly out of scope this pass:** did not touch `FlowRow.strike`'s DB-layer typing
or any other consumer of `flow_full_state.recent` (e.g. the Largo tool-facing `get_flow_tape`/
`get_ecosystem_context` JSON responses, which are machine-readable payloads for the LLM, not
rendered prose — C9's "round once at the presentation boundary" principle argues those should stay
raw for the model to reason over, and this fix does not touch them).
