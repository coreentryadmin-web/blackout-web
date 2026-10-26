## Swing `commitGateBlocksForVerdict()`'s genuine-G-S14-veto branch discarded the already-known Cortex source, rendering a generic sentence instead of naming which source vetoed

> **kind:** `FINDING`

| | |
|---|---|
| **Status** | FIXED (PR #TBD) |
| **Found by** | Live-production audit, Ask Largo × Night Hawk Swings standing ownership mandate (0DTE/Night Hawk Command "keep digging" sub-mandate), 2026-10-26 |
| **Scope** | `src/lib/swing/entry-verdict.ts` (`commitGateBlocksForVerdict`, the `b.includes("cortex_veto")` branch) — member/Largo-facing gate-block text on `ZeroDteCommandPanel`, the swing play-brief, and `entry-enterability.ts` |

### Root cause

`commitGateBlocksForVerdict()` turns persisted `commitGateBlockedBy` tokens into the member-facing
gate-block sentence. For a genuine Cortex veto, the persisted token is
`gate:G-S14:cortex_veto:<source>` — stamped by `swingCortexBlockedByFromAssessment`
(`src/lib/swing/v2/cortex-swing.ts`) directly off `cortex-gate.ts`'s own `cortexGateBlocks()`
code, `` `cortex_veto:${v.source}` ``, where `source` is one of the 8 `CORTEX_SOURCES`
(`src/lib/nighthawk/cortex/types.ts`: `gex-walls`, `wall-trend`, `flow-quality`, `sector-heat`,
`catalyst-news`, `vex-charm`, `darkpool-confluence`, `opening-harvest`).

The specific source that vetoed is therefore already embedded in the exact string the branch
pattern-matches against (`b.includes("cortex_veto")`), but the branch discarded it in favor of a
flat, source-less sentence: `"Cortex preflight vetoed this setup — desk will not open."`

This is narrower than the gap the 2026-10-25 fix (PR #6673, commit `381f1f803`) deliberately
deferred — that fix's follow-up is about recovering the FULL per-instance evidence sentence
(opposing sources, net score, etc.), which genuinely needs a schema change to persist
`pre.reason` from `discovery.ts` (not done, by design, to keep that PR single-issue). Naming just
the source requires no such change — it is a one-line string-split on data already present in the
token the function already branches on. PR #6673 correctly gave every OTHER G-S14 branch
(`cortex_net_negative`, `cortex_thin_evidence`, `cortex_contested`,
`cortex_gex_walls_oppose_unresolved`, `cortex_veto_blind`) its own specific, honest sentence —
only this one, the genuine-veto branch, was left generic.

The sibling 0DTE board (`src/lib/zerodte/cortex-gate.ts`'s own `cortexGateBlocks()` rendering,
shared by both engines) already preserves full source+detail text for its own veto rendering
(`` `Cortex veto [${v.source}]: ${v.detail}` ``) — only swing's `discovery.ts` persistence
(`blocked.set(key, pre.blockedBy)`, `pre.reason` never kept) plus this generic branch in
`entry-verdict.ts` lose the source specifically for the genuine-veto case.

Confirmed live 2026-10-26: `GET /api/market/nighthawk/horizons?view=swings` (authenticated via
`scripts/audit/lib/audit-auth-fetch.mjs` against `https://blackouttrades.com`) served MRNA in the
SWING lane's WATCH section with `commitGateBlockedBy: ["gate:G-S6:confluence",
"gate:G-S14:cortex_veto:gex-walls"]`. Tracing `commitGateBlocksForVerdict`'s G-S14 branch against
that exact token confirmed it returned only `{code: "g_s14_cortex", reason: "Cortex preflight
vetoed this setup — desk will not open."}` — the `gex-walls` substring sitting right after the
final colon in the string the branch was already testing (`b.includes("cortex_veto")`) was never
read out.

The existing regression coverage (`src/lib/swing/entry-verdict.test.ts`, the 2026-10-25 SOXX-repro
test) only asserted the genuine-veto case still contains the word "vetoed" — it asserted nothing
about naming the source, so this gap was never caught.

### Fix

In the `b.includes("cortex_veto")` branch (after the `cortex_veto_blind` check, which must stay
first since `"cortex_veto_blind"` also contains the substring `"cortex_veto"`), parse the source
out of the token itself: `` const last = b.split(":").pop(); const source = last &&
last !== "cortex_veto" ? last : null; `` — guarding against the no-source token shape
(`gate:G-S14:cortex_veto` with nothing after it, which `split(":").pop()` would otherwise read
back as the literal string `"cortex_veto"` itself) by falling back to the prior generic sentence
rather than naming a fake source. When a source is present: `` `Cortex preflight vetoed this
setup (${source}) — desk will not open.` ``.

This needs no new persisted field and no extra Cortex read — it only reads data already in the
string being matched, unlike the fuller per-instance evidence sentence the 2026-10-25 fix
explicitly deferred as a separate, larger follow-up.

### Regression test

Added a new test to the existing 2026-10-25 SOXX-repro block in `src/lib/swing/entry-verdict.test.ts`:
asserts `gate:G-S14:cortex_veto:gex-walls` renders a reason containing `gex-walls` (not just the
word "vetoed"), asserts a different source (`darkpool-confluence`) renders correctly too (not a
hardcoded single source), and asserts the no-source token shape (`gate:G-S14:cortex_veto`, which
should not happen in production but must not render a garbage source name if it ever does) still
falls back to the honest generic sentence.

### Verification

- RED→GREEN proof: added the new test first against the un-fixed branch — it failed (`Cortex
  preflight vetoed this setup — desk will not open.` does not match `/gex-walls/`). Applying the
  fix turned it GREEN with no other test regressed.
- `npx tsx --experimental-test-module-mocks --test src/lib/swing/entry-verdict.test.ts` (Node 20)
  — 26/26 pass (25 pre-existing + 1 new).
- `npx tsc --noEmit` (Node 20) — clean, exit 0.
- Full suite `npm test` (Node 20) — 17150 pass / 0 fail / 3 skipped (pre-existing skips,
  unrelated).
