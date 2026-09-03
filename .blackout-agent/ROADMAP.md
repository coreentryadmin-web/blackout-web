# ROADMAP — pointer, not a rewrite

BLACKOUT already has a roadmap; it's spread across a few docs that pre-date this bootstrap and
remain the source of truth. This file is a NOW/NEXT/LATER lens on top of them, not a replacement.

## Where the real roadmap content lives
- `docs/audit/certification-mandates/{LARGO,SEO,SPX-SLAYER,X-CONTENT}.md` — per-lane mandates for
  the 4 lanes that have a written one so far (out of the 9 owner-lane sessions this repo runs).
- `docs/audit/INTENTIONAL-DESIGN.md` — deliberate 0DTE design decisions + the specific measurement
  that would justify revisiting each. This is the closest existing analog to `DECISIONS.md`.
- `docs/audit/0DTE-RESEARCH.md` — evidence-driven research map for the 0DTE grinder + banger engine.
- `docs/audit/0DTE-UNIFICATION-DESIGN.md` — design of record for the two-engines-into-one effort.
- `docs/audit/LARGO-PRODUCT-CONTRACT.md` — the 10-point cross-product contract every desk follows.

## NOW (this cycle)
- Close BO-AUTOPILOT-0001, BO-P2-3425, BO-P3-3428, BO-P3-3429, BO-P2-3430 (see `AGENT_STATE.json`).
- Fold `findings-staging/` into `FINDINGS.md` (`BO-HOUSEKEEPING-FOLD`).

## NEXT (once NOW clears, no assigned P0/P1 open)
Enter DISCOVERY MODE per `CLAUDE.md`'s `NEVER SIT IDLE` section — rotate through production
health, data correctness, performance, the 7 products, infra/SRE, security, Largo torture-testing,
SEO/GEO, per the Autopilot request's own rotation list. The pre-existing `DISCOVERY lane — 24/7
new-work sweep` scheduled trigger (`15 * * * *`) already does this independent of whether this
particular session is running.

## LATER (needs more than one cycle / needs a decision)
- The 5 missing per-lane certification mandates (Vector, Night Hawk, Thermal, Helix, Meridian have
  no dedicated `certification-mandates/*.md` yet — SEO/SPX-Slayer/Largo/X-Content do).
- Full Cursor integration into this Autopilot state (see `docs/audit/AUTOPILOT-STATUS.md` §11 for
  exactly what's missing).
- Retroactively tagging the full historical `FINDINGS.md` corpus with lifecycle states (out of
  scope for this bootstrap — `FINDINGS.json` here only tracks items created/touched going forward).
