## 2026-10-08 — [FINDING, largo-swing] Management section's "Rails: ... target $X" line showed an already-banked trim level as a fresh, unmet objective, directly contradicting the "Trim ladder: +100% ✓" line one row above it — FIXED

> **kind:** `FINDING`

| Field | Value |
| --- | --- |
| **Status** | FIXED |
| **Severity** | P3 (no wrong number served — the dollar level itself was always correct; the defect is a self-contradictory narrative framing a member could misread as "still has room to run") |
| **Component** | `src/lib/swing/play-brief.ts` (`managementSection`, the "Rails: stop $X · target $Y" line) |
| **PR** | fix/swing-rails-target-reached |
| **Found via** | Ask Largo standing sub-mandate — this cycle's 5-engine live monitor, fetching fresh `GET /api/market/swing/play-brief` envelopes against `docs/audit/LARGO-PRODUCT-CONTRACT.md`'s ten points for EXTR (OPEN/SCALING_OUT), BSP (OPEN/COMMIT_NOW), RGNX (OPEN/MANAGING) and AAPL (two CLOSED chains) — fresh tickers not yet checked earlier this session. |

### Root cause

Swing's single-rung `SWING_SCALE_OUT_POLICY` (`exit-policy.ts`) prices its one trim trigger
(`trigger_pct`) identically to the policy's overall `target_pct` — both 100 — so once that rung
fires, the fired trim's own `premium` and `exitPolicy.target_premium` are the literal SAME dollar
level. `managementSection` rendered that level unconditionally:

```ts
if (ep.stop_premium != null || ep.target_premium != null) {
  lines.push(`Rails: stop ${fmtUsd(ep.stop_premium)} · target ${fmtUsd(ep.target_premium)}`);
}
```

with no check for whether a fired trim had already reached it. Live repro (`GET
/api/market/swing/play-brief?playId=SWING:EXTR&ticker=EXTR&status=OPEN`, 2026-10-08, ~19:15 ET):
the Management section rendered, back to back —

```
Trim ladder: +100% ✓
Rails: stop $0.06 · target $0.30
```

— entry $0.15, mark $0.38 (the position is +150%, well past the $0.30 trim trigger it already
fired at). A member reading top-to-bottom sees "target $0.30" presented as a fresh, unmet rail
directly beside its own "+100% ✓" disclosure that the identical level has already been hit and
banked — the exact self-contradiction `play-brief-intel.ts`'s "What to watch" section (a few
sections further down the SAME envelope) already named and fixed for its own "Premium target
rail" line on 2026-09-22 ("a direct self-contradiction... `Trim ladder: +100% ✓` ... `X% move
still needed`"). That 2026-09-22 fix only touched the later, more detailed section; this earlier,
more prominent Management-section summary line — the first place in the document a member sees
the rails at all — was never given the equivalent treatment. Confirmed by grep across
`play-brief.ts`/`play-brief-narrative.ts`/`play-brief-narrative-coaching.ts`/`play-brief-intel.ts`:
`managementSection`'s line was the only other call site rendering `target_premium` as a bare,
un-annotated value.

### Evidence

Live `GET /api/market/swing/play-brief?playId=SWING:EXTR&ticker=EXTR&status=OPEN` (2026-10-08,
~19:15 ET), a real committed BANGER-origin position:

- `trimsFired: 1`, `exitPolicy.trim_levels: [{ trigger_pct: 100, premium: 0.30, fired: true, ... }]`,
  `exitPolicy.target_premium: 0.30` — the fired trim's premium and the rail's target are the same
  number by construction.
- Position section, same envelope: `Entry: $0.15`, `Mark: $0.38 (2026-10-08 16:00 ET)`,
  `P&L: +150.0%`, `Blended P&L (realized trim + open runner): +125.0%`, `Banked: 50% @ +100%
  ($0.30)`.
- Management section, same envelope: `Trim ladder: +100% ✓` immediately followed by
  `Rails: stop $0.06 · target $0.30` with no annotation — reads as an unmet target despite the
  line directly above it saying otherwise.
- By contrast, the "What to watch" section further down the SAME envelope correctly omits its own
  "Premium target rail" line entirely once fired (the 2026-09-22 fix) — so the single document
  disagreed with itself about whether $0.30 was still ahead.

### Fix rationale

Mirrored the ladder's own already-established "✓" convention (used two words to the left, on the
same line, for the identical fact) rather than inventing new wording, suppressing the number, or
duplicating `play-brief-intel.ts`'s separate room%-computation logic (that section answers "how far
to a still-open target"; this one only needs "has this already happened," which the existing
`trim_levels[].fired`/`premium` fields answer directly without re-deriving a percentage):

```ts
const targetAlreadyFired =
  ep.target_premium != null &&
  ep.trim_levels.some((t) => t.fired === true && t.premium != null && t.premium >= ep.target_premium!);
const targetLabel = targetAlreadyFired
  ? `${fmtUsd(ep.target_premium)} ✓ (reached)`
  : fmtUsd(ep.target_premium);
lines.push(`Rails: stop ${fmtUsd(ep.stop_premium)} · target ${targetLabel}`);
```

A target not yet reached by any fired trim (RGNX/BSP live briefs, confirmed) still renders as a
bare figure — the fix only adds an annotation when the contradiction would otherwise exist; it
never suppresses or re-labels a genuinely forward-looking target.

**Blast radius:** `managementSection` is the only producer of this specific "Rails:" line; no
other call site renders `target_premium` this way (confirmed by the same grep noted above). Scoped
entirely to the one `if (ep.stop_premium != null || ep.target_premium != null)` branch — CLOSED
briefs (no `exitPolicy`) and OPEN briefs with an unfired/no-rung policy are byte-identical to
before.

### Evidence that the fix is real (RED → GREEN)

Added two tests to `src/lib/swing/play-brief.test.ts`:
1. `Rails target already reached by a fired trim is annotated, not shown as a bare unmet figure
   (live EXTR repro)` — fixture mirrors EXTR exactly (entry $0.15, mark $0.38, one `trigger_pct:
   100` rung fired at premium $0.30, `target_premium: 0.30`) and asserts the Management section
   matches `Rails: stop $0.06 · target $0.30 ✓ (reached)`.
2. `Rails target not yet reached renders as a bare figure (no false 'reached' annotation)` —
   identical fixture except the rung is unfired, asserting the line stays
   `Rails: stop $0.06 · target $0.30` with no "reached" annotation.

Ran test 1 against the pre-fix code via `git stash push -- src/lib/swing/play-brief.ts` (test file
kept): **RED** — `not ok ... target already hit by the fired trim must say so ... got: ... Trim
ladder: +100% ✓\n\nRails: stop $0.06 · target $0.30` (no annotation), reproducing the exact live
EXTR contradiction. After `git stash pop` restoring the fix: **GREEN**, full
`src/lib/swing/play-brief.test.ts` suite 122/122 pass (both new tests included), no regressions.
`npx tsc --noEmit` clean. Full `npm test` run in progress at write time — recorded in the PR once
green.
