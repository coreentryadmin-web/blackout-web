# Meridian cross-product moat — Vector inline preview

> **kind:** `FINDING`

| **Status** | FIXED in `cursor/meridian-cross-product-moat-3d11` |
| **Audit** | `docs/audit/MERIDIAN-CTO-AUDIT-2026-08-25.md` §5 idea 3 |
| **Surface** | Meridian earnings → Positioning tab |

## Problem

Thermal and HELIX already render live inline cards on Positioning (king nodes, flow skew, strike
stacks). Vector was only a plain "Jump to desk" link even though `intel.vector` was populated with
expected-move bands server-side — beads, wall dynamics, and chart flow never reached the panel.

## Fix

- Fetch cache-first `fetchVectorFullState(ticker, "weekly")` in the earnings event parallel loader
  (shared with intel prefetch).
- Extend `MeridianEarningsVectorRead` with regime, walls, flip, max pain, wall-event narration,
  flow-marker prints, bead sample count, and freshness note.
- Pure shaping in `meridian-vector-for-earnings-core.ts`; render a **Vector structure** card beside
  Thermal / HELIX on `MeridianEarningsIntelPanel`.
- Action dock hint clarifies that structure previews are inline when live.

## Evidence

- Unit tests: `meridian-vector-for-earnings-core.test.ts`
- No fabricated numbers — card hidden when `available: false`
