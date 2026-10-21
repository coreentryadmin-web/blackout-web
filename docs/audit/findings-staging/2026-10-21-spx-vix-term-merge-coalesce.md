## 2026-10-21 — [FINDING, spx-slayer] `mergePulseIntoDesk` silently drops the scored "VIX curve" factor on `GET /api/market/spx/play` via a `??` that keeps a defined-but-empty placeholder

> **kind:** `FINDING`

| Field | Value |
| --- | --- |
| **Status** | FIXED |
| **Severity** | P2 (scoring input silently dropped — sibling endpoints disagree on the same underlying data at the same instant) |
| **Surface** | `src/features/spx/lib/spx-desk-merge.ts` — `mergePulseIntoDesk()` |

### Root cause

`mergePulseIntoDesk` merges the fast ~1s pulse lane onto the slower ~10s base desk build with
`vix_term: pulse.vix_term ?? base.vix_term`. The off-hours "serve today's own settled close"
branch of `buildSpxDeskPulse` (`spx-desk.ts`, ~lines 2155-2196) returns `{...empty, available:
true, price: prior.pdc, ...}` without ever reassigning `vix_term`, so it stays at the empty-shell
placeholder defined at line ~2046: `{vix9d: null, vix3m: null, structure: "unknown", detail: ""}`.
That placeholder is a **defined object**, not `null`/`undefined`, so `??` keeps it and discards
the real `base.vix_term` the slower desk build actually computed. `GET /api/market/spx/desk` is
built via `loadSpxDesk()`/`buildSpxDesk` directly and never goes through this merge, which is why
the two sibling endpoints can disagree on the identical underlying VIX data at the identical
timestamp.

This is the same class of bug the file's own `leader_stocks` field two lines below the fix
already guards against — `pulse.leader_stocks.length ? pulse.leader_stocks : base.leader_stocks`
checks for real content instead of a bare `??`, specifically because an empty-but-defined array/
object can legitimately arrive from the pulse lane.

### Evidence

Live `GET /api/market/spx/desk` (as_of `2026-10-21T06:36:09.090Z`): `vix_term = {vix9d: 16.27,
vix3m: 18.99, structure: "contango", detail: "Contango — 9d 16.27 < 3M 18.99 (+2.72)"}` —
`|termDiff| = 2.72 > 1`, the threshold `spx-signals.ts` (lines 764-789) uses to push a `+4` "VIX
curve" factor. Live `GET /api/market/spx/play` fetched the same instant (`as_of
2026-10-21T06:36:09.105Z`) returned 11 factors summing exactly to the reported score
(`-18+14-10+6-6+5-5+4+4+0+0 = -6`, matches `score: -6`) with **no "VIX curve" factor anywhere**.

Added two tests in `spx-desk-merge.test.ts`'s existing "off-hours derived-field fallback" describe
block (the established home for this exact pulse/base-fallback bug class). RED→GREEN, git-stash-
verified on the source file alone: 12/13 (1 fail) before the fix, 13/13 after. Broader regression
sweep: `spx-desk-merge.test.ts` + `spx-signals.test.ts` + `spx-desk-offhours-spot.test.ts` —
41/41. `tsc --noEmit` clean.

### Blast radius

Single field in a single merge function — `GET /api/market/spx/play`'s confluence score and the
`desk.vix_term` object it exposes. The sibling `data_quality` field one line below (`pulse.
data_quality ?? base.data_quality`) has the identical structural shape (the off-hours branch also
leaves it at its own empty placeholder, `{vix_term_partial: false, missing: []}`), but a repo-wide
grep confirms `desk.data_quality` has **zero consumers** anywhere outside this merge function
itself — no UI, no scoring, no other route reads it — so it was deliberately left unchanged here;
fixing dead code with no observable behavior change would be scope creep, not a fix.

### Fix

Changed the coalesce to check for real content first, mirroring `leader_stocks`'s existing
pattern in the same function: `pulse.vix_term && (pulse.vix_term.vix9d != null ||
pulse.vix_term.vix3m != null) ? pulse.vix_term : base.vix_term`. Falls back to `base.vix_term`
only when pulse's own value is the empty off-hours placeholder; still prefers pulse's real data
(including a legitimately partial read where only one of `vix9d`/`vix3m` resolved) when it has
any.

### Why not a bigger fix

Did not touch `data_quality` (same shape, same root cause) — it has no consumers, so changing it
changes nothing observable; noted above as the acknowledged, deliberately-untouched sibling. Did
not change `buildSpxDeskPulse`'s off-hours branch itself (leaving the real `vix_term` unset there
is fine now that the merge layer correctly treats an empty placeholder as absent).
