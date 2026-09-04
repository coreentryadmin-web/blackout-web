# Swing Command V2 — Design Spec (North Star)

**Status:** DRAFT · 2026-09-04  
**Owner:** Night Hawk / Swing lane  
**Goal:** Build the best multi-session options command system on the platform — **clearer than 0DTE for money management**, **faster where it matters**, **honest about staleness**, with a **native Largo overlay** for thesis interrogation.

---

## 1. North star

> A member opens **Swings** and instantly knows: *what to do*, *why*, *what changed since entry*, and *what happens next* — with **money fields updating every second** on open capital, discovery refreshing on a sane cadence, and **Largo one click away** with full swing context.

**Beat 0DTE on:**
- Multi-day thesis persistence (pillars that evolve over sessions, not intraday VWAP noise)
- Section-native management (COMMIT → MANAGING → SCALING_OUT → EXITING as first-class UI)
- Roll-chain / hold-time analytics (0DTE cannot do this)
- Cross-signal corroboration (Vector, Banger, Flow, Thermal) on one row

**Match 0DTE on:**
- Marks SSE ~1s, honest LIVE/STALE/CLOSED chrome
- Executable bid/ask P&L when quotes exist
- Premium hero + management cards + excursion graphic
- Strict WATCH ≠ OPEN (no fake P&L on candidates)

**Do not blindly copy:**
- 1s full-board SWR for 200 discovery rows (wasteful)
- Intraday time-stop at 15:50 ET (wrong for 5–15 DTE)
- Ratchet track UI (swings use SCALE_OUT / trim ladder)

---

## 2. Design principles

| # | Principle | Implication |
|---|-----------|-------------|
| P1 | **Split refresh planes** | Discovery ≠ positions ≠ marks. Each plane has its own cadence and transport. |
| P2 | **Observable routing** | UI sections mirror `serving.ts` — never score-sort into misleading buckets. |
| P3 | **Honest liveness** | LIVE only when `mark_as_of` fresh; dim stale rows; never fabricate marks. |
| P4 | **Capital-first** | Open positions get 1s marks + 1 Hz management recompute; WATCH gets underlying track only. |
| P5 | **Frozen at commit** | Entry context, exit policy, thesis pillars latched — live overlay *interprets*, not rewrites. |
| P6 | **Largo-native** | Every panel field maps to a `ProductRead` / tool arg — agent and UI share vocabulary. |
| P7 | **Mobile command** | List ↔ detail routing; section chips collapse; Largo drawer not a second app. |

---

## 3. Architecture — three planes + overlay

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  SWING COMMAND COCKPIT (new)                                                 │
│  Session P&L · open risk · section counts · scan freshness · regime chip    │
└─────────────────────────────────────────────────────────────────────────────┘
         │
    ┌────┴────┬──────────────────┬─────────────────────────────────────────┐
    │         │                  │                                         │
    ▼         ▼                  ▼                                         ▼
 PLANE A   PLANE B            PLANE C                                  PLANE D
 Discovery  Positions           Marks + spot                            LARGO
 ~5s RTH    ~2s RTH open book    ~1s SSE marks                           on-demand
 ~15s off   event-driven push    ~10s REST quotes + spot SSE           + 30s context
            on manage events     1 Hz mgmt recompute                     drawer
```

### Plane A — Discovery (slow, wide)

- **Source:** `GET /api/market/nighthawk/horizons?view=swings` + Redis `swing:serving:latest`
- **Cadence:** 5s RTH / 15s off-hours (keep); optional **15s RESEARCH-only** sub-poll
- **Payload:** 7 sections, dossier factors, archetype, sub-lane, graduation flags
- **Client:** `useSwingDiscoveryDeck()` — does **not** block marks plane

### Plane B — Positions (fast, narrow)

- **New:** `GET /api/market/swing/positions/live` (or horizons `?slice=positions`)
- **Cadence:** **2s RTH** for OPEN/HOLD/TRIM rows only (~20–40 rows max)
- **Payload:** ledger fields, manage events, frozen `exit_policy`, thesis snapshot ids
- **Push trigger:** `swing-active-refresh` cron → SSE event `swing.position.updated` (future)

### Plane C — Marks & management (fastest)

- **Reuse:** `/api/market/zerodte/marks/stream` (swing OCCs already merged in poller)
- **Add:** `useSwingLiveDeck` parity with `useZeroDteLiveDeck`:
  - `refreshSwingManagement()` @ 1 Hz
  - `latchLiveExcursion()` (already via overlayLiveMarks)
  - `computeSwingThesisHealth()` client overlay from frozen pillars + live marks
- **Spot:** shared quote stream; prioritize working → watch tickers

### Plane D — Largo overlay

- **New UI:** `SwingLargoRail` — collapsible right drawer (desktop) / bottom sheet (mobile)
- **Context bundle:** selected play + section + lane snapshot + `get_swing_record` summary
- **Actions:** ask Largo, “explain thesis break”, “compare to Vector”, “size check”
- **No duplicate chat** — deep-link to `/terminal` with prefilled swing context when needed

---

## 4. Layout — panel inventory

### 4.1 Cockpit strip (above deck — **new, swing-only**)

| Widget | Data | Refresh |
|--------|------|---------|
| **Session P&L** | sum open `live_pnl_pct` × risk weight | 1s (marks) |
| **Open / Watch counts** | section totals | 5s discovery |
| **Win rate (30d)** | `swing/record` summary | 30s |
| **Scan freshness** | `scan_as_of` ET chip | 5s |
| **Regime chip** | breadth / sector rotation from discovery meta | 5s |
| **Risk budget** | open premium at risk vs daily cap | 2s positions |

*Exceeds 0DTE:* multi-day session stats + section breakdown in one glance.

### 4.2 Left rail — Command queue (enhanced)

**Keep:** 7-section filter bar (`COMMIT_NOW` … `EXITING`)  
**Add:**

| Feature | Description |
|---------|-------------|
| **Section rails** | Collapsible groups with live counts; keyboard `1–7` jumps |
| **Signal badges** | `VECTOR` `BANGER` `FLOW` chips on row |
| **Sub-lane pill** | TACTICAL 5–7d / STANDARD 8–15d |
| **Thesis ring** | Health 0–100 on MANAGING+ rows (like 0DTE rank ring) |
| **Age decay** | Days since trigger / since commit (swing-native) |
| **Sort modes** | Section order · conviction · P&L · DTE · freshness |

### 4.3 Right rail — Swing Command Panel (fork from ZeroDte)

**Not a tabbed legacy UI.** Single scroll with **swing-native zones:**

```
┌─ TradeSummaryHero ─────────────────────────────────────────┐
│ Ticker · LONG · MANAGING · 80 · 12C · 8DTE · BANGER+VECTOR │
│ Current · Peak · Thesis · Rank · Age (days)                  │
└────────────────────────────────────────────────────────────┘
┌─ Stream chip ──────────────────────────────────────────────┐
│ ● LIVE · mark $2.60 · Δ0.58 · Θ -0.04 · OCC ⧉ · 1s ago    │
└────────────────────────────────────────────────────────────┘
┌─ Verdict band ─────────────────────────────────────────────┐
│ HOLD · +24% · "Thesis intact — scale-out ladder step 1"    │
└────────────────────────────────────────────────────────────┘

 TWO COLUMNS (desktop) / STACK (mobile)
 ┌─ Trade command ─────────┐  ┌─ Thesis intelligence ────────┐
 │ Scale-out ladder (live)   │  │ SwingThesisHealthPanel       │
 │ Excursion graphic         │  │ Factor breakdown (dossier)   │
 │ Roll plan (if applicable) │  │ Signal corroboration stack   │
 │ Greeks + IV context       │  │ "Why we picked it" evidence  │
 │ Premium at risk           │  │ Regime + archetype narrative │
 │ Session log / timeline    │  │ Largo quick-prompts          │
 └───────────────────────────┘  └──────────────────────────────┘

┌─ Cross-desk strip ─────────────────────────────────────────┐
│ Vector → · HELIX flow · Thermal · Night Hawk 0DTE sibling  │
└────────────────────────────────────────────────────────────┘
```

#### Panel modules (new / extended)

| Module | 0DTE has? | Swing V2 |
|--------|-----------|----------|
| `SwingThesisHealthPanel` | partial (`ThesisHealthPanel`) | **New pillars:** persistence, entry geometry, flow corroboration, regime drift, theta budget |
| `ScaleOutLadder` | trim_scale only | **Always** for SCALE_OUT; steps from frozen `exit_policy` |
| `RollPlanCard` | no | show when `roll_plan.ts` active |
| `SignalCorroborationStack` | Vector chip only | Vector + Banger + flow flags with timestamps |
| `SwingMarkHistoryChart` | yes (0DTE) | multi-day mark path, session boundaries |
| `HoldTimeClock` | no | days in trade + DTE remaining dual clock |
| `SwingAnalyticsDrawer` | NighthawkAnalyticsPanel | mirror for `/swing/record` — roll-chain P&L curve |
| `SwingLargoRail` | no | contextual agent overlay |

### 4.4 Largo overlay panel (`SwingLargoRail`)

**Placement:** third column (ultrawide) or slide-over drawer; persists open state in localStorage.

**Context auto-injected on row select:**

```typescript
type SwingLargoContext = {
  play: TerminalPlay;
  section: SwingServingSection;
  laneSnapshot: { scan_as_of; section_counts; regime };
  recordSummary?: SwingRecordSummary; // last 30d
  tools_prefetch: ["get_swing_horizon", "get_swing_record", "get_ecosystem_context"];
};
```

**Suggested quick actions (chips):**

- “Is this thesis still valid?”
- “What would make me exit?”
- “Compare flow to Vector leaders”
- “Size vs open risk budget”
- “Explain this scale-out step”

**Backend work:**

- Add `get_swing_record` Largo tool (parity with `get_zerodte_record`)
- Extend `compactSwingLane` samples with `serving`, `liveStatus`, `manageAction`, `signalKinds`
- `ProductRead<SwingHorizon>` per Largo contract

---

## 5. Scenario matrix (every state the UI must handle)

### 5.1 Pre-entry

| Section | Member question | UI must show | Marks behavior |
|---------|-----------------|--------------|----------------|
| **COMMIT_NOW** | “Act now?” | Entry, contract, floor cleared, gates | quote-only mid; **no P&L** |
| **WAITING_FOR_ENTRY** | “Wait for what?” | Entry geometry, chase risk, unlock time | underlying track % only |
| **WATCH** | “Worth watching?” | Factors, score vs floor, flag time | underlying track %; label “SINCE FLAG” |
| **RESEARCH** | “Why here?” | Invalidated / cold bucket / missing data | no marks |

### 5.2 Live position

| Section | Member question | UI must show | Marks behavior |
|---------|-----------------|--------------|----------------|
| **MANAGING** | “Hold or adjust?” | Thesis health, ladder next step, excursion | **1s SSE** executable P&L |
| **SCALING_OUT** | “Bank or runner?” | Partial fill history, trail from peak | **1s SSE** + peak latch |
| **EXITING** | “Get out” | Thesis break reason, exit urgency | **1s SSE** until flat |

### 5.3 Provenance collisions

| Scenario | Rule |
|----------|------|
| Swing ledger OPEN + Banger OPEN same ticker | **Swing ledger wins** (canonical); show Banger badge as signal only |
| Discovery COMMIT + Banger OPEN | Banger row replaces discovery (pre-entry) |
| Vector leader + WATCH swing | Enrich with VECTOR `signalKinds`; don't auto-promote |
| Legacy promoted play | Re-resolve contract DTE; frozen OCC from ledger |

### 5.4 Market / session edge cases

| Case | UI behavior |
|------|-------------|
| Marks stale >5s | STALE chip, dim row, mgmt uses last mark with warning |
| Session closed | CLOSED badge; freeze P&L at last RTH mark |
| RTH open, no SSE | REST fallback 2.5s; never fake LIVE |
| Illiquid contract (no bid/ask) | Show mid-only P&L; “illiquid” gate chip |
| DTE rolls 5→4 overnight | Row exits swing lane or migrates to 0DTE per spine rules |
| Thesis break mid-session | Animate section change MANAGING → EXITING |
| Partial scale-out | TRIM status; SCALING_OUT section; ladder step checked |

### 5.5 Member workflows

| Workflow | UX path |
|----------|---------|
| Morning scan | Cockpit → COMMIT_NOW filter → sort by conviction |
| Manage open book | MANAGING + SCALING_OUT → sort by P&L |
| Research backlog | RESEARCH → expand factor panel |
| Post-mortem | Analytics drawer → closed plays → link to Largo |
| Cross-desk | Vector strip → `/vector?ticker=` |
| Legacy handoff | Legacy → “moved to Swings” → `dispatchGotoSwing` |

---

## 6. Data contracts (API additions)

### 6.1 Extend horizons response

```typescript
type SwingLanePayload = {
  sections: Record<SwingServingSection, HorizonPlay[]>;
  scan_as_of: string;        // ET stamp — member-visible
  scan_session_day: string;  // YYYY-MM-DD ET
  regime?: RegimeSummary;
  open_risk_usd?: number;
};
```

### 6.2 New: positions slice (optional fast path)

`GET /api/market/swing/positions/live` → open book only, 2s cache bust.

### 6.3 SSE: swing events (phase 2)

`GET /api/market/swing/events/stream` — manage events, section changes, thesis breaks (not full discovery).

### 6.4 Largo tools

| Tool | Purpose |
|------|---------|
| `get_swing_horizon` | exists — extend payload |
| `get_swing_record` | **new** — parity zerodte record |
| `get_swing_play` | **new** — single play dossier by ticker |
| `explain_swing_action` | **new** — why section / manage action |

---

## 7. Implementation phases

### Phase 0 — Parity (1–2 weeks) · *ship first*

- [ ] `useSwingLiveDeck` → add `refreshSwingManagement` @ 1 Hz
- [ ] `terminalPlayFromHorizon` → wire `exitPolicy` + frozen scale-out ladder
- [ ] `computeSwingThesisHealth` + `SwingThesisHealthPanel` (swing pillars)
- [ ] `SwingCockpitStrip` — session P&L, counts, freshness
- [ ] `SwingAnalyticsPanel` — wire `/api/market/swing/record`
- [ ] Horizons API → expose `scan_as_of` on lane

### Phase 1 — Beat 0DTE UX (2–3 weeks)

- [ ] Fork `SwingCommandPanel` from `ZeroDteCommandPanel` (swing-specific zones)
- [ ] `SignalCorroborationStack` (Vector/Banger/Flow)
- [ ] `SwingMarkHistoryChart` (multi-day)
- [ ] `HoldTimeClock` + sub-lane styling
- [ ] Positions plane 2s poll or SSE push
- [ ] Mobile: section keyboard shortcuts + drawer layout

### Phase 2 — Largo overlay (2 weeks)

- [ ] `SwingLargoRail` component + context bundle
- [ ] `get_swing_record` + `get_swing_play` tools
- [ ] Quick-action chips → Largo run-tool
- [ ] Prefetch ecosystem context on row select

### Phase 3 — Intelligence (ongoing)

- [ ] Calibration graduation → live score floors
- [ ] `swing/events` SSE for section transitions
- [ ] Roll plan UI integration
- [ ] Portfolio risk budget enforcement surfaced in cockpit
- [ ] Backtest-linked confidence on COMMIT_NOW rows

---

## 8. Success metrics

| Metric | Target |
|--------|--------|
| Open position mark latency p95 | <2s |
| Stale mark visibility | 100% rows >5s show STALE |
| WATCH rows with P&L label | 0% (audit) |
| Section mis-route rate | 0 (serving.ts unit + e2e) |
| Largo context completeness | play + section + record on every ask |
| Member time-to-action (MANAGING) | measurable ↓ vs baseline |

---

## 9. File map (planned)

```
src/features/nighthawk/command-deck/
  SwingCommandPanel.tsx          # fork of ZeroDteCommandPanel
  SwingThesisHealthPanel.tsx
  SwingCockpitStrip.tsx
  SwingAnalyticsPanel.tsx
  SwingLargoRail.tsx
  use-swing-live-deck.ts         # + mgmt refresh
  use-swing-discovery-deck.ts    # plane A only
  swing-management-overlay.ts    # refreshSwingManagement

src/lib/swing/
  thesis-health.ts               # multi-day pillars
  management-overlay.ts          # 1 Hz recompute

src/app/api/market/swing/
  positions/live/route.ts
  events/stream/route.ts         # phase 2

src/lib/largo/
  product-reads.ts               # get_swing_record, enrich horizon
```

---

## 10. Open decisions

1. **4–15 vs 5–15 DTE spine** — product call; UI should use `dteRangeLabel("SWING")` everywhere.
2. **Dedicated swing marks SSE** — vs shared zerodte stream (current: shared; monitor cap).
3. **Largo inline vs drawer** — recommend drawer + `/terminal` deep link for long answers.
4. **Auto-merge policy** — swing PRs require adversarial review before merge (operator mandate).

---

*This spec supersedes informal gap lists in `SWING-COMMAND-UNIFICATION.md` for V2 scope; unification checklist remains the P0 baseline.*
