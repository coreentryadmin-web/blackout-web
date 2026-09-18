> **kind:** `FINDING`

## Ask Largo swing brief's "Recent prints" section silently mixed a 48h premium-sorted list into a line-item next to a 6h HELIX aggregate, reading as a self-contradiction — FIXED

| Field | Value |
|---|---|
| **Status** | FIXED |
| **Area** | Night Hawk Swings / Ask Largo play-brief (`src/lib/swing/play-brief-intel.ts`) — found via the Ask Largo standing mandate's 5-engine health-check deep-dive |
| **Severity** | P2 (a real, honestly-computed data mismatch presented with no disclosure of its own window/ordering, reading as an internal contradiction in the brief's own prose) |
| **PR** | fix/swing-flow-prints-window-mislabel |

### Root cause

`flowIntelSection`'s "Recent prints" block reads `eco.flow_full_state.recent`, sourced from
`fetchFlowFullState(ticker)` (`src/lib/bie/ecosystem-context.ts:780-781`), which calls
`getFlowTapeSummary({ ticker, limit: FLOW_FULL_STATE_LIMIT })` with **no `since_hours`/`order`**
argument. Per `flow-service.ts:29`'s own default —
`order: opts?.order ?? (opts?.since_hours != null && opts.since_hours <= 6 ? "recent" : undefined)`
— omitting both resolves to `order: undefined`, which `db.ts`'s `fetchRecentFlows` treats as
`ORDER BY COALESCE(total_premium,0) DESC NULLS LAST` (`db.ts:3087-3088`) over a **default 48-hour**
window (`sinceHours = params.since_hours ?? 48`, `db.ts:3041`) — biggest-premium-first, not
recency-first, and a different window than the adjacent "HELIX tape (Xh)" aggregate line
(`trustedHelixFlow`'s `FLOW_SUMMARY_WINDOW_HOURS = 6`).

The section header (previously `"**Recent prints:**"`) never disclosed either fact, so the two
lines read as describing the same population when they don't.

Live repro (real production data, authenticated Clerk session): AAPL position #37 (HOLD) showed
`"HELIX tape (6h): put-heavy — calls $263K · puts $1.3M · 4 prints"` immediately followed by
`"Recent prints: CALL 350 $3,430,000.00…"` — a single line item ~13x the entire 6h call aggregate
directly above it, reading as an internal contradiction in the brief's own math.

### Evidence

- `flow-service.ts:29` — confirmed the exact default-ordering derivation as described.
- `db.ts:3041, 3087-3088` — confirmed the 48h default window and premium-desc default ordering.
- `ecosystem-context.ts:780-781` — confirmed `fetchFlowFullState` calls `getFlowTapeSummary` with
  neither `since_hours` nor `order` set.
- Live AAPL #37 repro as described above.
- RED→GREEN independently reproduced via `git stash push -- src/lib/swing/play-brief-intel.ts`:
  1/167 fail pre-fix (matching the fix's own new assertion), `git stash pop` → 167/167 pass
  post-fix.
- Broader `src/lib/swing/*.test.ts` sweep: 1337/1337 pass.
- `npx tsc --noEmit -p .` on Node 20: clean.

### Blast radius

Presentation-only, single section (`flowIntelSection`'s prints block in `play-brief-intel.ts`).
`fetchFlowFullState`'s underlying query is untouched — its `count`/`total_premium`/`top_tickers`
fields are intentionally 48h/premium-sorted and are consumed correctly elsewhere; this fix does
not change what data is fetched, only how the one prose line describing it is labeled.

### Fix rationale

Relabeled the section header from `"**Recent prints:**"` to
`"**Notable prints (48h, largest premium first):**"` so the line honestly states its own window
and ordering, and added a per-print relative-age suffix (via the existing `relativeAgeLabel`
helper, same pattern already used two lines up for the "Flow anomalies" block) so a reader can see
how old the largest print actually is without cross-referencing another section. Chose relabeling
over changing the query to match the 6h HELIX window, because `flow_full_state.recent`'s 48h/
premium-sorted shape is deliberately different data (a "biggest recent prints" view, not a
"freshest prints" view) — changing the query would silently narrow what members can see, whereas
disclosing the window/ordering fixes the honesty problem without losing information.

### Verification

Independently re-verified from scratch on a fresh branch off actual latest `origin/main` — the
claimed default-ordering chain was grep-confirmed at flow-service.ts:29, db.ts:3041/3087-3088, and
ecosystem-context.ts:780-781; RED/GREEN independently reproduced via `git stash`; broader
`play-brief*.test.ts`/`swing/*.test.ts` sweep and `tsc --noEmit` both clean.
