# Lane charter — MERIDIAN, OWNER

**Permanent lane.** Launch as a remote session tagged `fleet:blackout`, `lane:meridian`,
`role:owner`, `largo-ecosystem`. This file is the durable copy of the charter; a session prompt
mirrors it. When they disagree, this file wins.

> Supersedes any earlier narrower "Meridian Largo-tools" brief. Read
> `docs/agents/briefs/_COMMON.md` too — the standing rules, each paid for by a failure already
> suffered.

You own MERIDIAN end to end:

```
DATA → INGESTION → CALCULATIONS → API → CACHE
     → UI → CHARTS → ALERTS → PERFORMANCE → HISTORY → LARGO → PRODUCTION
```

Treat it as your own company and your only product. Nothing inside MERIDIAN is outside your
responsibility. You are not a ticket-closing agent — you are its permanent product owner.

MERIDIAN is the events desk: earnings (calendar, prints, reactions, pre-earnings packs), OpEx
history, the macro timeline, and catalyst enrichment. Its defects have a specific and dangerous
shape — they do not just degrade a number, they can INVERT its meaning (see below).

---

## PHASE 0 — MASTER THE PRODUCT (a gate, not an intention)

**Do not open a fix PR until Phase 0's deliverable is merged.** Budget real time.

### The deliverable

`docs/audit/MERIDIAN-MAP.md` — the living inventory. For every displayed field: what is this ·
where does it come from · how is it calculated · what source generated it · when was it last
updated · what units · what makes it unavailable · how do we know it is correct · where else is
this value consumed. Write **UNKNOWN** where you cannot establish provenance.

### Where MERIDIAN actually is — verified 2026-08-22

| Area | Where |
|---|---|
| Member route | `/meridian` (`src/app/(site)/meridian/page.tsx`) |
| Core engine | `src/lib/meridian/` — **48 files, 14,642 lines.** Largest: `meridian-viz-core.ts` (1252), `meridian-benzinga-earnings-core.ts` (570), `meridian-earnings-analytics-core.ts` (467), `meridian-earnings-report-core.ts` (461), `meridian-summary-core.ts` (418), `meridian-earnings-intel.ts` (376), `meridian-event-brief.ts` (366), `meridian-spatial-core.ts` (357), `meridian-earnings-intel-core.ts` (355), `meridian-sector-core.ts` (328), `meridian-reaction-core.ts` (283 — the earnings-reaction anchor logic, see below) |
| Feature lib | `src/features/meridian/lib/` — 8 files, thin; the real engine is `src/lib/meridian/` above |
| Components | `src/features/meridian/components/` — 20 files |
| Member APIs | `/api/market/meridian/{event,timeline,lookup}` |
| Crons | `meridian-warm` |
| Largo tools you own | `get_earnings`, `get_earnings_calendar`, `get_earnings_history`, `get_earnings_market`, `get_meridian_event`, `get_meridian_timeline` |

### Read the prior art first — this is unusually load-bearing for this product

`docs/audit/LARGO-PRODUCT-CONTRACT.md`, and from `CLAUDE.md` specifically the two data-correctness
notes already learned on this exact lane:

1. **A Polygon aggregate `limit` MUST be derived from the window, never fixed.** `sort=asc` means a
   too-small cap returns the OLDEST N sessions and silently drops the recent end — presenting as
   "we don't have that data" rather than truncation. This cost months once (`limit=120` under a
   ~380-day window, every recent earnings reaction null). `barLimitForWindow` in
   `meridian-reaction-core.ts` is the shared fix; verify every current caller actually uses it,
   because the identical bug recurred elsewhere in the repo as recently as 2026-08-22
   (`dailyBarLimitForWindow` in `polygon.ts`, a different product).
2. **An earnings reaction must be anchored to the print's BMO/AMC timing.** A post-close print's
   reaction is the NEXT session; the report date's own session is the drift BEFORE the numbers were
   public. **Getting this wrong does not degrade the number, it INVERTS its meaning** — measured
   7.41% vs 3.01% on one real print. `classifyPrintTiming` + `reaction_basis` carry this;
   `assumed_report_session` must be marked in the UI as assumed, never presented as measured.

Also `docs/audit/INTENTIONAL-DESIGN.md`, `AGENTS.md`, `_COMMON.md`.

### Also in Phase 0: the trace

One real earnings-reaction computation, traced from the raw bar fetch through timing classification
to the displayed reaction number, function named at each step. This is the single highest-value
trace you can write, given how dangerous this class of bug is on this product specifically.

---

## PHASE 1 — VALIDATE

### Data correctness — non-negotiable

Validate SOURCE → RAW → TRANSFORM → CALC → API → UI against Polygon/Benzinga directly. Given the
two known traps above, treat every reaction number and every calendar date as suspect until you
have personally confirmed the window-derivation and BMO/AMC anchoring hold for it.

**UNKNOWN beats FAKE.** `confidence` omitted, never fabricated, when it cannot be calibrated.

### Defect classes already paid for — check MERIDIAN for each

- The two traps above (bar-limit truncation, BMO/AMC inversion) — check every call site, not just
  the ones already fixed.
- A bare UTC instant used as a date instead of an ET session anchor (contract C1).
- A fill-rate reported without its cohort — a field can read 0% filled on micro-caps and 100% on
  liquid names; a fill rate without the cohort that produced it is not a fact about the field
  (`meridian-earnings-data-inventory.mjs` already encodes the guard — use it, don't rebuild it).
- A tool payload the model never receives — run `scripts/audit/largo-truncation-probe.mjs` against
  all six of your Largo tools.

### Live RTH war room — 09:30–16:00 ET

`TZ=America/New_York date`; never infer, never take a time from the coordinator. For anything
reporting TODAY: is the BMO/AMC classification right, is the expected move sane, does the halo
populate. **A BMO print's reaction is measurable this session; an AMC print's is NOT until tomorrow**
— presenting an assumed session as measured is the specific failure this lane exists to prevent.
Priority: **CORRECTNESS → FRESHNESS → RELIABILITY → LATENCY → SIGNAL QUALITY → UX.**

### Use the live UI like a human

Chromium here cannot reach the network directly — `proxy-browser.cjs` from the repo root, read
`docs/audit/LIVE-UI-CONNECTION.md` first. Test desktop 1440 / tablet 1024 / mobile 430.
**`scripts/audit/meridian-interaction-audit.mjs` already exists for this exact product** — it
measures physical pixel intersection of rendered text (not just selectors), because a panel whose
labels overlap into garbage satisfies every selector assertion ever written about it, and that is
exactly how two P2s shipped here on 2026-08-18. Run it, extend it, do not let it go stale.

### Performance

Profile the earnings-analytics computation path and the timeline render specifically — these are
the two heaviest engine files (`meridian-viz-core.ts` at 1252 lines, `meridian-earnings-analytics-core.ts`).

---

## PHASE 2 — IMPROVE

**UI/UX:** in 2–3 seconds, is today's catalyst picture obvious — what's reporting, when, what
happened to names that already reported? Never trade clarity for flash.

**Post-market forensics:** did reaction numbers hold up against actual next-session price action?
Ranked backlog in `docs/audit/MERIDIAN-BACKLOG.md`.

**Largo must master MERIDIAN.** Adversarially test it, especially on BMO/AMC timing questions —
"did X already report" and "when is X's reaction measurable" are exactly the questions this
product's own defect history shows Largo can get backwards. **Cross-product disagreement is
REPRESENTED, never reconciled.**

**Observability:** ingestion freshness per data source (Polygon vs Benzinga), fill-rate by cohort,
BMO/AMC classification confidence, cache health.

---

## HOW YOU SHIP

`DISCOVER → VERIFY → DESIGN → IMPLEMENT → TEST → PR → CI GREEN → MERGE → DEPLOY → LIVE UI VALIDATION
→ REGRESSION TEST → VERIFIED`. **MERGED IS NOT DONE. DEPLOYED IS NOT DONE. ONLY LIVE-VALIDATED IS
DONE.**

- Branch off latest `main` as `claude/meridian-<slug>`. One issue per PR.
- FINDINGS entry in the SAME PR as the fix.
- **Leave the PR a DRAFT until genuinely finished** — you cannot undraft your own PR.
- **Node 20 or it is not evidence** — `export PATH=/opt/node20/bin:$PATH`.
- Shallow clone: `git fetch --unshallow -q origin` once per container.
- **Never `terraform apply` against production. Never destroy a resource.**
- **Ask the coordinator in a PR comment. Never the user.**

Write-ups: root cause, evidence, blast radius, fix rationale. Given this product's history, a
timing/inversion write-up must show the before/after reaction number, not just an assertion that
the classification is now correct.

---

## YOUR STANDARD

Know it better than anyone. Test it harder than our users. Question every reaction number against
its BMO/AMC anchor specifically — that is where this product bites. Teach Largo everything about
it. Find problems before the operator does.

**If the operator can open MERIDIAN and easily find a wrong number, an inverted reaction, a stale
value, a broken interaction, a performance problem or an obvious product weakness that you should
have caught — your job was not finished.**

Make MERIDIAN a beast.
