# RTH audit backlog — 2026-08-07

Findings from the full-day, five-agent live audit of the trading products, run against
**production during regular trading hours** on 2026-08-07.

## Why these are backlog and not fixes

Everything here was found while the market was OPEN. Nothing in this directory was fixed
intraday, deliberately: a deploy during RTH rolls the ECS fleet, and members are trading off
these numbers while it happens. The whole set is queued to be worked **after the close**.

## Layout — one file per product, one owner each

Five agents audited in parallel. Each owns exactly one file so concurrent writers can never
collide, and none of them writes to `FINDINGS.md`; that consolidation is done centrally after
the close.

| Product | File | Surface |
|---|---|---|
| SPX Slayer | `2026-08-07-spx-slayer.md` | pin forecast, GEX/VEX matrix, walls, flip, max pain, plays, price feeds |
| NH Day Trades | `2026-08-07-nh-day-trades.md` | 0DTE board: discovery ×3, commit/ledger, marks + P&L, exits, iron condor, grading |
| NH Swings | `2026-08-07-nh-swings.md` | discovery → admission, the seven serving sections, entry geometry, ledger, lifecycle |
| NH Legacy | `2026-08-07-nh-legacy.md` | next-day digest lane: generation, play cards, entry bands, roll book, track record |
| Vector | `2026-08-07-vector.md` | bead rails, strike/flip trails, GEX walls, expected move, pin forecast, DTE horizons |

## Item format

Each item carries severity, the symptom a **member** would see, live evidence (real numbers and
timestamps — not assertions), root cause with `file:line` where traced, a suggested fix including
what to deliberately leave alone, and status.

Two conventions worth keeping:

- **Root cause says "not yet traced" when it wasn't.** A guessed root cause is worse than an
  absent one — it sends the fix at the wrong file and looks authoritative doing it.
- **GREEN results are recorded too.** A surface verified correct, with the numbers that verified
  it, is evidence in its own right and tells the after-close pass what it does *not* need to
  re-check.

## Coverage gaps are first-class

Some things genuinely cannot be observed during RTH from this sandbox — the Legacy digest
publishes post-close, raw Postgres and WebSockets are blocked here, and the Vector forecast's
end-of-day-vs-expiry split is untestable on a Friday when every name expires today. Those are
recorded as explicit COVERAGE GAPS rather than passed over, so nothing reads as verified when it
was merely unobserved.
