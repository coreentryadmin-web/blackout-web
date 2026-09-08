> **kind:** FINDING

## Largo C2 (freshness) — stale GEX-only gamma posture drove GEX-king/magnet directional narration — FIXED

**Status:** FIXED (this PR)

### Root cause

`tradeManagerNarrativeSection` in `src/lib/swing/play-brief-narrative.ts` narrates the GEX king
strike and gamma magnet focal levels via `narrateKing`/`narrateMagnet`, both of which take a
`posture` argument that decides the entire directional claim of the line:

```ts
posture === "long"
  ? "Pin risk — dealers hedge into this strike; expect chop around it."
  : "Max-gamma node — moves can accelerate through if wall fades."
```

Before this fix, `posture` was resolved inline at each call site as
`vec?.regime?.posture ?? ctx.ecosystem?.gex_positioning?.gamma_posture ?? null` — the same
GEX-only stale-fallback bug class already fixed in `gexPostureSection` (#4360),
`counterThesisLine` (#4364), `watchForSection` (#4367), and `chartLevelsSection` (#4372), but
missed at this fifth call site because it sits inside the always-shipped
`tradeManagerNarrativeSection`, not one of the previously-audited helper sections.

The king/magnet **level itself** is correctly staleness-gated in `collectFocalLevels`
(`kingFromStaleGex` suppresses a GEX-only king strike when the matrix is stale). But `posture` is
an **independent** data point from the same `gex_positioning` blob, read a second time at the
narration call site with no staleness check at all — so even when the king/magnet level passed
its own freshness gate (e.g. because it came from live Vector data), the posture qualifying that
level's narrative could still be silently sourced from a stale GEX-only cache, producing a
confident "Pin risk / dealers hedge" or "acceleration" call off minutes-old positioning data.

### Evidence

- `narrateKing`/`narrateMagnet` (`play-brief-narrative.ts:225-247`) both branch on `posture ===
  "long"` with no fallback text distinguishing "known short" from "unknown" — a stale-GEX "long"
  read and a genuinely-long read render byte-identical text, so the staleness silently corrupts a
  live-reading trader's confidence in the call.
- New regression test `"stale GEX-only gamma posture must not drive GEX king narration (Largo
  C2)"`: RED pre-fix (`git stash` on `play-brief-narrative.ts` only) — asserted `/Pin risk/i` fired
  off a `gamma_posture: "long"` read with `matrix_age_sec: 200` (stale) and no live Vector regime;
  GREEN post-fix — falls back to the posture-unknown `/Max-gamma node/i` text.
- Companion test confirms live Vector `regime.posture` still drives the directional call even when
  the GEX matrix is independently stale (no over-correction).
- `npx tsc --noEmit` — clean.
- `node --experimental-test-module-mocks --import tsx --test src/lib/swing/*.test.ts` —
  750/750 pass.

### Fix

Extracted a shared `resolveGammaPosture(ctx, vec)` helper (mirrors the per-value gating pattern
in `collectFocalLevels`/`counterThesisLine`): live `vec?.regime?.posture` always wins; the
GEX-only `gamma_posture` fallback is used only when `gexMatrixStale()` is false. Both `narrateKing`
and `narrateMagnet` call sites now go through it instead of resolving posture inline.

### Blast radius

`tradeManagerNarrativeSection`'s king/magnet narration only (`play-brief-narrative.ts`). The
magnet branch is currently unreachable in practice (a `magnetCoaching` bullet from
`play-brief-narrative-coaching.ts` is added earlier and dedups the later `narrateMagnet` call via
its own `/Gamma magnet/i` bullet-text check), but the fix keeps both paths consistent since that
dedup is an implementation detail, not a contract — a future change to bullet ordering or the
dedup key would otherwise silently reintroduce the bug on the magnet path. The GEX-king branch is
reachable today and was the live bug.

### Market-open validation

See `docs/audit/MARKET-OPEN-VALIDATION.md` — next RTH session, pull `GET
/api/market/swing/play-brief` for an open position whose GEX king strike is Vector-sourced (live)
while the ecosystem `gex_positioning` blob is independently stale (`matrix_age_sec` > 120s), and
confirm the king-strike line reads "Max-gamma node" (posture-unknown) rather than a confident
"Pin risk" call.
