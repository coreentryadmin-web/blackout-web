# Night Hawk 3-Rail Redesign — roadmap (standing, keep updated)

> **kind:** ROADMAP — design brief + execution tracker, not a single-issue finding. Update the
> STATUS table as PRs land; do not let this drift out of sync with what's actually shipped.

Origin: a live, iterative product-direction session (2026-08-28), grounded against a screenshot
of the X Ads Manager UI (flat underline tabs, dot-prefixed status labels, a real date-range
dropdown, thin progress bars under stat values, a rich expandable icon sidebar) and against a
screenshot of the Night Hawk 0DTE command panel as it looked before this session's work. The full
verbatim briefs are preserved below (§1–§2); §3 is the execution tracker.

**Standing instruction that produced this doc:** *"Make sure you save all this like a roadmap and
work on all this and don't miss anything."* Do not let a single item silently drop — if something
here turns out to be infeasible (e.g. it would require inventing data the backend doesn't have),
say so explicitly in the STATUS table rather than quietly skipping it, matching this repo's
"never fabricate" standing practice (see the main `CLAUDE.md`, Largo product contract section).

---

## 1. The architecture (first brief)

Three rails, each answering a different question, and **the questions each rail answers change
with the play's lifecycle state** — WATCH / OPEN / CLOSED are meant to be different interfaces
built on shared structure, not the same interface with different data filtered in:

```
RAIL 1 — WHAT SHOULD I LOOK AT?      Trade Queue     (Candidates / Open trades / History)
RAIL 2 — WHAT SHOULD I DO?           Trade Command   (Should I enter? / Hold-Trim-Exit? / What happened?)
RAIL 3 — WHY? AND IS IT STILL TRUE?  Thesis Rail     (Why this setup? / Is thesis intact? / Why did it work/fail?)
```

### Rail 1 — Trade Queue
Extremely clean. Not analytics, not charts, not paragraphs — just enough to decide which play
needs attention. Three segmented states at the top: `WATCHING 4 | OPEN 2 | CLOSED 7`. Each card is
dense: ticker + direction + tier, contract + DTE, status/return, a timestamp. Clicking a card
drives both Rail 2 and Rail 3.

### Rail 2 — Trade Command (lifecycle-dependent)
- **WATCH → "Setup Command"**: current vs. trigger price + distance, target/invalidation levels,
  a `WAITING FOR TRIGGER` state, and an explicit "what's missing" line (e.g. *"Waiting for $219.40
  breakout + volume confirmation"*).
- **OPEN → "Trade Command"**: Entry/Current/Peak as the hero row (`$3.12 → $4.45 → $5.10`, with
  `+42.6%` / `+63.5%` under Current/Peak), a small P/L lifecycle chart (entry → now → peak,
  connected dots), then a management recommendation styled as a real state indicator, not a nav
  button: `🟡 HOLD — thesis 84% intact, next trim +50%` / `🟠 TRIM 25% — target 1 reached,
  momentum slowing` / `🔴 EXIT — VWAP lost + Helix reversed`. Buttons are `[ TRIM ] [ HOLD ]
  [ EXIT ]` — no `SELL`, redundant with `EXIT`.
- **CLOSED → "Trade Outcome"**: Entry/Exit/Peak, Opened/Closed/Duration, a headline result, and a
  lifecycle strip (`WATCH → TRIGGER → OPEN → TRIM → EXIT`).

### Rail 3 — Thesis / Intelligence (lifecycle-dependent, and archetype-aware)
- **WATCH → "Setup Confluence"**: which factors are `READY` vs `BUILDING` for THIS archetype
  specifically (a FLOW setup's checklist ≠ a BREAKOUT setup's ≠ a REVERSAL setup's — see the
  factor lists below), plus an explicit "what's missing" callout.
- **OPEN → "Thesis Integrity"**: a computed 0–100 score + rung (e.g. `84% — INTACT`), and —
  this is explicitly called out as **the killer feature** — a per-factor **entry vs. now**
  comparison table (`VWAP: Above✓ → Above✓ →` / `RSI: 61✓ → 68⚠ ↘`), not a static checklist.
  Highlight what changed since entry.
- **CLOSED → "Post-Trade Attribution"**: what worked (bar-graded factor strength), what ended the
  trade, and an "exit quality" framing (`Captured 91% of maximum available P&L`) so Closed Plays
  becomes a learning surface, not "a cemetery of old trades."

Per-archetype Rail-3 factor lists (don't show one universal indicator set):
- **FLOW**: Helix persistence, ask aggression, premium acceleration, volume/OI, price
  confirmation, VWAP, GEX.
- **BREAKOUT**: breakout level, relative volume, momentum, relative strength, VWAP,
  market/sector alignment, GEX.
- **REVERSAL**: VWAP deviation, exhaustion, RSI, flow reversal, put/call wall, failed breakdown,
  volume.

### Page-level hierarchy (declutter direction, second brief)
```
BLACKOUT NAV
↓
0DTE | SWINGS | BANGERS | VECTOR | LEGACY        (moved directly under the global nav)
↓
WATCH | OPEN | CLOSED  +  Long/Short  +  Search  (immediately below the view toggle)
↓
PLAY QUEUE | TRADE COMMAND | THESIS INTELLIGENCE (the 3-rail workspace, fits without scrolling)
```
Remove entirely: "Overnight playbook" kicker, the duplicate "Night Hawk" title/badge labels, the
per-view blurb sentence, and the Opps/Top/Edge/Engine-heartbeat/SPX-Slayer-badge/Risk-P&L cockpit
strip. "Session Analytics" stays conceptually but becomes a compact button (`SESSION ANALYTICS ↗`)
opening a full-width drawer/modal on click — valuable, but not more important than the current
trade, so it shouldn't consume prime vertical real estate by default.

### Plays table redesign (third brief)
Columns: `# | ACTION | PLAY | ENTRY | CURRENT | P&L | RATING | TIME` — **`ACTION`, not `STATUS`**,
because OPEN/WATCH/CLOSED is already represented by the selected queue filter; the valuable
per-row question is *"what should I do right now?"*. ACTION vocabulary changes by lifecycle, and
**the table's own columns should change by lifecycle too** — don't force one column set onto all
three states:
- **WATCH ACTION values**: `WAIT` (setup developing) / `ARMED` (conditions almost satisfied) /
  `ENTRY VALID` (trigger confirmed — deliberately not "ENTER", which reads as an instruction
  rather than system state) / `ENTRY EXTENDED` (moved past ideal entry, not "CHASE") / `SKIP`
  (setup deteriorated before entry).
- **OPEN ACTION values**: `HOLD` / `TRIM 25%` / `TRIM 50%` / `EXIT` / `RUNNER`.
- **CLOSED — no ACTION column at all.** Show `RESULT` instead (an outcome/reason, not an
  instruction): `TARGET` / `STOPPED` / `THESIS BROKE` / `EOD EXIT` / `TRAIL EXIT` / `SCRATCH`.
  Closed table columns: `# | RESULT | PLAY | ENTRY | EXIT | P&L | GRADE | TIME`.

### "Visual intelligence" instead of a debug-log evidence dump (fourth brief)
The current cross-desk evidence block (`HELIX ... ALIGNED / THERMAL ... ALIGNED / VECTOR no
structure read / NIGHTHAWK REJECT · Flow Following · OPP / MERIDIAN no catalyst`) has valuable
underlying information but reads like log output. Turn it into a real visual: per-source dot-bar
strength (`●●●●○  Bullish flow  ↗`) plus a headline (`THESIS — 60% WEAK`, `2/5 systems confirm`).
**Critically distinguish three states that are NOT the same thing**: `NO DATA` (the source never
returned a read) ≠ `NEUTRAL` (the source read and found nothing directional) ≠ `OPPOSED` (the
source actively disagrees with the thesis) — collapsing these into one visual would misrepresent
absence as neutrality, which this repo's Largo product contract (`docs/audit/
LARGO-PRODUCT-CONTRACT.md`) already treats as a first-class distinction elsewhere.

### Small UI polish cues collected across the session (X Ads Manager reference, screenshots)
- Flat underline tabs for the top-level view switcher (bold+bright active label, thin 2px
  accent underline, no filled-pill background) — **not** a filled equal-width pill row.
- Status labels as a colored dot + colored text, **no box** (border/background/padding) around
  them — flatter than a "badge."
- A real date-range dropdown (trigger button showing the current range + a floating preset
  panel), not flat pill buttons — but scoped honestly to what the backend can actually serve
  (see STATUS below on why this is a *preset* dropdown, not an arbitrary start/end calendar).
- Thin progress bars directly under a stat value (dot/bar showing % of something), used
  consistently rather than invented ad hoc per surface.
- A rich, expandable left icon sidebar (icon + label + grouped sections: Campaigns/Creatives/
  Tools) as the *expanded* state of what we ship today as an icon-only collapsed rail.
- Professional font-size/weight hierarchy — bold the single most-scanned number per row/card,
  not everything.
- (Explicitly asked, explicitly scoped back by the assistant as a separate, much larger project
  — see STATUS): light/dark theme toggle. The whole design system today is hardcoded dark colors,
  not swappable CSS custom properties, so this needs a token-conversion pass before any palette
  work, not a quick add.

---

## 2. Data-reality grounding (from a repo research pass, 2026-08-28)

Before building anything against this brief, an Explore pass mapped what's REAL vs. what would
require inventing data. Full findings live in this session's transcript; the load-bearing facts:

- **`thesisHealth` (the Rail-3 "killer feature") already exists server-side**, computed in
  `src/lib/zerodte/thesis-health.ts` (`computeThesisHealth`) for every OPEN/HOLD/TRIM 0DTE play
  with a frozen `entry_context`: a 0–100 `health` score, an `entryIndex`/`currentIndex`/`delta`, a
  `rung` (`INTACT`/`MINOR`/`WEAKENING`/`DEGRADED`/`BROKEN`/`OPPOSITE`), and `pillars[]` — each
  carrying `commitScore`/`currentScore`/`commitLabel`/`currentLabel`/`status`/`deltaPts` for
  VWAP, momentum, flow, dealer(GEX)/structure, darkpool, rel_volume, tape, market, confluence,
  cortex, volatility. **RSI is not currently one of the pillars** (the math exists in a different
  product lane — "BIE" — but isn't wired into this pipeline).
- **A fully-built, fully-styled render of that exact payload already existed on disk**
  (`ThesisHealthPanel.tsx` + its CSS in `globals.css`, `.nh-deck-thesis-health` / `.nh-deck-th-*`)
  but was UNREACHABLE — its last call site sat behind a dead `!premium` branch that was always
  `false` for 0DTE plays. **This shipped in PR #3089** (see STATUS).
- **Per-archetype factor weighting for Rail 3 already exists too**: `buildThesisWeightProfile`
  (`thesis-health.ts`) reweights the health pillars by `discoveryOrigin`/`why_now.reason` — FLOW
  origin boosts the `flow` weight and cuts `vwap`/`structure`; BREAKOUT boosts `structure`+`vwap`;
  PIN boosts `dealer`. There's a separate, richer `TradeArchetype`/`ThesisRail` gate system
  (`src/lib/zerodte/thesis/archetype-gates.ts`) that isn't the same taxonomy as `discoveryOrigin`
  — reconciling which one Rail 3 should read from is unresolved, flagged below.
- **A numeric "distance to trigger" for WATCH plays does NOT exist as a stored field.**
  `ArchetypeGateResult` (`archetype-gates.ts`) carries a real `verdict: PASS|WATCH|BLOCK` + string
  reason codes per archetype (e.g. `"breakout_coiled_pre_trigger"`, `"flow_event_not_campaign"`,
  `"gamma_no_structure"`, `"pre_1000_et"`) — a real, archetype-aware "what's missing" taxonomy, but
  not a numeric distance. Turning it into "$X away from trigger" needs a real derivation from rail
  scores, not already computed.
  **Correction (2026-08-29), checked directly against `evaluateArchetypeGates`'s call sites:**
  those `blocks`/`notes` reason codes are consumed ONLY inside the discovery/scoring pipeline
  (`src/lib/zerodte/thesis/pipeline.ts` and `live-pipeline.ts`) — grep-verified as the sole two
  call sites outside the gate file itself. **They never reach `TerminalPlay`.** The `gates` field
  `TerminalPlay` DOES already carry (`Array<{label, ok}>`, rendered today in "Gates at commit") is
  a completely different, unrelated concept — commit-time "Hard gate"/"Tape align" pass/fail
  checks (`adapters.ts` ~line 279), not the archetype-specific WATCH reason codes. So the WATCH
  ACTION vocabulary item (`WAIT`/`ARMED`/`ENTRY VALID`/`ENTRY EXTENDED`/`SKIP`) is not just a UI
  build — it needs a NEW data path piping `evaluateArchetypeGates`'s real verdict+codes from the
  pipeline into the board payload / `TerminalPlay` first, or it will end up either fabricating the
  distinction or (worse) silently reusing the wrong `gates` field and mislabeling commit-time
  checks as WATCH-lifecycle readiness.
- **"Exit quality" / "% of peak captured" is NOT a stored field**, but the ingredients are real
  (`peak`, `exitPnlPct` both on `TerminalPlay`) — `exitPnlPct / peak × 100` is an honest, light
  client-side derivation, not fabrication, as long as it's labeled as derived.
- **The lifecycle timeline (WATCH→TRIGGER→OPEN→TRIM→EXIT) already exists and is honest about
  unknowns**: `src/lib/zerodte/play-timeline.ts` (`buildPlayTimeline`) produces events with a
  `timeSource: "live"|"engine"|"reconstructed"|"scheduled"` tag and a `null` (never fabricated)
  clock when a time genuinely isn't known.
- **Current UI structure**: `CommandDeck.tsx` is a 2-pane layout (play list + one
  `<PlayTerminal>` detail panel). For 0DTE specifically, `PlayTerminal` delegates to
  `ZeroDteCommandPanel.tsx` — a SINGLE scrolling panel (not the tabbed Thesis/Management/PnL
  system Swing/Legacy horizons use). Turning this into a real 3-column layout means restructuring
  `CommandDeck`'s outer container into a 3-slot grid AND splitting `ZeroDteCommandPanel`'s content
  into "Rail 2 content" vs. "Rail 3 content" — real structural work, not yet done (see STATUS).
- **The API only supports a rolling "last N days ending today" window** (`GET
  /api/market/zerodte/record?days=N`, capped at 90) — there is no arbitrary start/end date-range
  endpoint. This is why the shipped range picker (PR #3091) is a PRESET dropdown, not an X-style
  arbitrary calendar, and why a real per-day drill-down (the calendar heat-strip, PR #3088) is the
  honest analog instead.
- **The CLOSED-row RESULT vocabulary in §1's plays-table brief only half matches real data —
  checked directly against `plan.ts`'s grader (2026-08-29).** The 0DTE grader's real
  `exit_reason` enum is exactly `"trim_scale_first" | "trim_scale_second" | "doubled" | "stopped"
  | "time_stop"` (grep-verified against every `exit_reason:`/`closed_reason:` literal across
  `src/lib/zerodte/*.ts`, including `iron-condor.ts` — no `"target"`, `"ratchet"`, or
  `"thesis_break"` value exists anywhere in the real 0DTE grading code). So:
  - `TARGET` → real, maps to `"doubled"` (the +100% target-hit case).
  - `STOPPED` → real, maps to `"stopped"` directly.
  - `EOD EXIT` → real, maps to `"time_stop"` directly.
  - `THESIS BROKE`, `TRAIL EXIT`, `SCRATCH` → **no corresponding field.** `play-timeline.ts`'s
    `closeLabel()` helper does reference `exitReason === "target"` and `closedReason === "ratchet"`
    in its own logic, but those values are never actually produced by `plan.ts` — they read as
    dead/legacy branches (or cover a different, now-removed engine), not evidence the values are
    real today. Implementing these three literally as distinct outcomes would fabricate data the
    backend doesn't emit. If the desk wants them, they need either a genuine new backend
    classification (e.g. deriving "thesis broke" from `play.thesisBreak.level === "break"` at
    close time, which IS real but is a different signal than `exit_reason`) or should be dropped
    from the vocabulary — a decision for whoever picks up the ACTION-column item, not something to
    silently paper over with a fabricated label.
  - The OPEN-row vocabulary (`HOLD`/`TRIM 25%`/`TRIM 50%`/`EXIT`/`RUNNER`) fares better: `HOLD`
    maps to the real `Recommendation` type's `"HOLD"`; `EXIT` maps to `"SELL"`; `RUNNER` is
    **already a real label** used by `trimLadderVisual()` in `terminal-display.ts` for the
    post-all-trims-fired ladder rung. The literal `TRIM 25%`/`TRIM 50%` split is not guaranteed —
    real trim tranches carry their own `trigger_pct` field
    (`exitPolicy.trim_levels[i].trigger_pct`), so an honest version reads `TRIM {trigger_pct}%`
    off that real field rather than hardcoding 25/50.

---

## 3. STATUS — keep this in sync with what's actually merged

Legend: ✅ shipped & merged · 🟡 open PR (not yet merged) · ⬜ not started · 🔬 deliberately scoped
back with a stated reason (not silently dropped)

**Consolidation note (2026-08-29):** PRs #3089/#3090/#3091/#3093/#3094/#3095/#3096 were all green
and stuck in draft behind the `AGENT_RELEASE_TOKEN` PAT rate limit (see `CLAUDE.md`'s GitHub API
budgets section — that limiter is on the SAME account the whole fleet shares, so it starves exactly
when there's a backlog). Rather than wait on six separate undrafts, all 7 commits were
cherry-picked verbatim (in dependency order, thesis-integrity before the 3-column split that
depends on it) onto one branch, re-verified in full from scratch (tsc/eslint/stylelint/1209 tests,
all clean), and opened as **PR #3099**. The 7 rows below marked ✅ are shipped in content and
verified, but as of this writing are physically merged via #3099 rather than their original PR
numbers — the originals will be closed as superseded once #3099 merges, not before.

| Item | Status | PR / note |
|---|---|---|
| Ticker search + direction/origin row badges on the board | ✅ | #3084 |
| Real per-play mark-history chart (0DTE, option minute bars) | ✅ | #3085 |
| Desktop icon sidebar (collapsed state) to switch systems | ✅ | #3086 |
| Stray-file cleanup | ✅ | #3087 |
| History table: date-range window + filters + sort + calendar heat-strip + row detail drawer | ✅ | #3088 |
| Wire the dormant `ThesisHealthPanel` (the real Rail-3 entry-vs-now comparison) into `ZeroDteCommandPanel` | ✅ | #3089 |
| Remove Overnight-Playbook kicker, duplicate "Night Hawk" labels, per-view blurb, and the Opps/Top/Edge/Engine/SPX-Slayer/Risk/P&L cockpit strip | ✅ | #3090 |
| Real date-range PRESET dropdown for History (scoped honestly — see §2) | ✅ | #3091 |
| Flat underline tabs for the top-level view switcher | ✅ | #3093 |
| Flat dot+text status pills (no box) | ✅ | #3094 |
| 2-column split of the command panel (Trade Command \| Thesis Intelligence, side by side, collapsing to one column under 1400px) | 🟡 | #3096 → folded into consolidated PR #3099 (see note below). Splits `ZeroDteCommandPanel.tsx`'s existing content into the two rails via a CSS grid; does NOT yet touch `CommandDeck.tsx`'s outer container, so Rail 1 (the play queue) is still a `<PlayTerminal>` sibling, not a third persistent column — see the next row. |
| **Full 3-column PERSISTENT layout** (Trade Queue always visible alongside Trade Command + Thesis Intelligence, not just the 2 inner rails split) | ⬜ | Still the single largest remaining structural item — restructures `CommandDeck.tsx`'s outer `.nh-deck-left`/`.nh-deck-right` container itself. Not started. |
| Rename `STATUS` column → `ACTION`, with lifecycle-specific vocabulary (WAIT/ARMED/ENTRY VALID/ENTRY EXTENDED/SKIP for WATCH; HOLD/TRIM 25%/TRIM 50%/EXIT/RUNNER for OPEN; no action column + RESULT vocabulary for CLOSED) | ⬜ | **Fully grounded, not yet built (2026-08-29) — see §2.** OPEN vocabulary maps cleanly to real fields (`Recommendation`, `trim_levels[i].trigger_pct`, the existing `RUNNER` label) — buildable as-is. CLOSED vocabulary is only half-real: `TARGET`/`STOPPED`/`EOD EXIT` map to real `exit_reason` values (`doubled`/`stopped`/`time_stop`), but `THESIS BROKE`/`TRAIL EXIT`/`SCRATCH` don't exist as distinct backend outcomes — implement only the 3 real ones, or add a genuine derivation for the rest, never fabricate literal labels for them. WATCH vocabulary is the hardest of the three: `archetype-gates.ts`'s real verdict+reason-code taxonomy exists but is confirmed NOT wired to `TerminalPlay` at all (consumed only inside `pipeline.ts`/`live-pipeline.ts`) — this item needs a new data path added before any UI work, not just a rendering pass. |
| WATCH-specific "Entry Readiness" rail (now vs. required per factor, `N/M conditions met`, explicit "what's missing" line) | ⬜ | Needs the archetype-gate reason-code taxonomy (`archetype-gates.ts`) turned into a real readiness UI — the gate verdicts exist, the UI doesn't. |
| CLOSED-specific "Post-Trade Attribution" rail (what worked / what ended it / capture % / thesis evolution entry→peak→exit) | ⬜ | `exitPnlPct/peak` capture-% derivation is honest and ready to build; the entry→peak→exit per-factor evolution table needs a 3-snapshot comparison the current `thesisHealth` (2-snapshot: commit vs. now) doesn't carry — would need either a peak-time snapshot to be stored, or an honest 2-column (entry→exit) version instead of 3. |
| "Visual intelligence" dot-bar strength display + explicit NO DATA / NEUTRAL / OPPOSED distinction, replacing the debug-log-style evidence block | ⬜ | Not started. The underlying per-source read already exists (`DeskEvidenceStack`/`entry_context.cortex` sources) — this is a presentation rebuild, same "surface what's real" pattern as PR #3089. |
| Session Analytics collapsed to a compact button + full-width drawer/modal | ⬜ | Today it's already collapsible inline (`NighthawkAnalyticsPanel`'s `nh-analytics-panel-collapsed` state, shipped separately pre-dating this brief) but is NOT yet a drawer/modal — it still occupies its row in the normal flow when expanded. |
| Reconcile `discoveryOrigin` (legacy FLOW/BREAKOUT/PIN) vs. the newer `TradeArchetype`/`ThesisRail` taxonomy for which factor list Rail 3 shows per archetype | ⬜ | Naming/plumbing gap noted in §2; needs a decision before the per-archetype Rail-3 factor lists in §1 can be built exactly as specified (REVERSAL in the brief maps to `MEAN_REVERSION`/`FAILED_BREAKOUT` in the newer taxonomy, not a literal "REVERSAL" label). |
| Rich expanded left sidebar (icon + label + grouped sections, matching X's expanded state) | ⬜ | We ship the collapsed icon-only state (#3086) today. |
| Light/dark theme toggle | 🔬 | Explicitly scoped back as its own project — the color system is hardcoded dark values throughout, not CSS custom properties; doing this right means a token-conversion pass first, then a real light palette, not a quick add alongside everything else. |

**Reading this table**: every ⬜ row above is real, scoped, buildable work — none of it was silently
dropped. The full 3-column PERSISTENT layout (Rail 1 always visible alongside 2+3, not just the
2-column split already shipped) is the single highest-leverage next item. The ACTION-column
vocabulary item's grounding work is done (see its row and §2) — implementing it should read fields,
not invent them, for exactly the labels flagged there as unsupported.
