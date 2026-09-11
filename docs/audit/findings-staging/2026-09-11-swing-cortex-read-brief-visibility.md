## 2026-09-11 — Swing Cortex evidence (pinned at commit) never reached the Ask Largo play-brief — FIXED

> **kind:** FINDING

| | |
|---|---|
| **Area** | Night Hawk Swings — Ask Largo play-brief (`src/lib/swing/play-brief*.ts`), `TerminalPlay`/adapters (`src/features/nighthawk/command-deck/{types,adapters}.ts`) |
| **Status** | FIXED |

**Symptom.** For a swing position that Cortex actually opposed or vetoed at commit (G-S14, the
evidence layer 0DTE and Swings both wire in), the member had zero visibility into that signal
anywhere in the play-brief or any other Largo surface — even though the exact evidence vector
that produced it was already sitting in the DB row, pinned for precisely this purpose.

**Root cause — a real read-path gap, not a missing feature.** Swing `commit.ts` (~line 583) pins
`entry_context.cortex = cortexEntryContextFor(cand.cortexAssessment ?? null)` on every committed
row — the SAME shared helper 0DTE uses, producing the SAME `ZeroDteCortexEntryContext` shape
(`decision`, `score`, `conviction`, `vetoes`/`supports`/`opposes` as `EvidenceItem[]`, and a
ready-made human-readable `narrative: string[]`). `SwingPositionRow.entry_context` (`db.ts:7326`)
carries it all the way to the DB row. But nothing downstream ever read it for swing:
- `play-brief-resolve.ts` fetches `SwingPositionRow` (which DOES carry `entry_context`) via
  `fetchOpenSwingPositions`/`fetchSwingPositionsRange`, but never touched the `cortex` field.
- `terminalPlayFromHorizon`/`terminalPlayFromClosedSwing`
  (`features/nighthawk/command-deck/adapters.ts`) extracted `tier`, `condor`, `why_now`,
  `thesis_first` etc. from entry_context onto `TerminalPlay` — but not `cortex`. `TerminalPlay`
  had no `cortex` field at all.
- The only place swing Cortex reasoning was even readable was `src/lib/bie/cortex-read.ts`'s
  `readCortexForPlay()` — hardcoded to the 0DTE `zerodte_setup_log` table, with no swing
  equivalent.

Net effect: for a swing position where Cortex actively opposed (the analogous live pattern the
0DTE-side `cortex-oppose-magnitude-ab.mjs` finding already measures), a member asking Largo "why
is this a hold" or reading the brief had no way to see that signal, even though it was computed
honestly server-side and pinned exactly for this purpose. Same absence-principle class as #4101's
`unavailableSources` fix (data computed honestly, silently dropped before reaching the member) —
scoped and posted as a PR #4076 comment (id 5627711092) last cycle before shipping.

**Fix.**
1. `TerminalPlay` (`command-deck/types.ts`) gains an optional `cortex?: PaneCortexView | null`
   field — `PaneCortexView` (not the raw entry-context union) because it's parsed STRUCTURALLY via
   `readCortexView` (`zerodte/pane.ts`), the same reader `bie/cortex-read.ts` already trusts for
   0DTE — never trusting the raw JSONB blob directly.
2. `HorizonDeckSource` (adapters.ts) and `SwingClosedDeckSource` (`swing/closed-plays.ts`) each
   gain an optional `cortex?: unknown` passthrough field (the raw `entry_context.cortex` blob).
   `terminalPlayFromHorizon` parses it via `readCortexView(src.cortex ?? null)`;
   `terminalPlayFromClosedSwing` forwards it unchanged. `closedDeckSourceFromRow` populates it
   from `row.entry_context?.cortex ?? null`.
3. `horizonRowToDeckSource` (`play-brief-resolve.ts`) gains an optional third `cortex` parameter,
   only passed at the ONE call site that has the raw ledger row (`loadOpenTerminalPlay`, an OPEN
   position) — `row.entry_context?.cortex ?? null`. The lane-only/WATCH call site passes nothing:
   Cortex is only pinned on a COMMITTED row, so a pre-commit candidate has no cortex to surface,
   and this stays honestly `undefined` there rather than fabricated.
4. New `cortexReadSection()` in `play-brief-intel.ts`, wired into `buildIntelSections` right after
   `archetypeTrackRecordSection`. Renders a "Cortex read" section ONLY when there is real signal
   to report: a non-abstained verdict carrying at least one veto or opposing item. A clean/
   supportive read, an abstained read, or no pinned verdict at all (pre-wire-in row, WATCH/lane-
   only candidate) all render nothing — never a fabricated "Cortex is fine" line, per the Largo
   product-contract absence principle (§3: omit an uncalibrated/absent read, never guess). Prefers
   the pinned `narrative` lines (the same human-readable strings the verdict composer already
   writes); falls back to a constructed veto/oppose summary only when narrative is empty.

**Blast radius.** Purely additive — no existing field, section, or 0DTE code path was touched.
`arsenal.unavailable_sources`/`buildRichEnvelope()` wiring (already fixed by #4101) is untouched,
per this cycle's explicit scope. The 0DTE `bie/cortex-read.ts` path is untouched; this only adds a
swing-side read using the same structural parser it already relies on.

**Tests.** `src/lib/swing/play-brief-intel.test.ts` (new):
- `cortexReadSection: null when the play carries no Cortex read at all` (undefined/null) —
  pre-wire-in / WATCH-only candidates render nothing.
- `cortexReadSection: null when Cortex abstained` — an abstain is not a signal to surface here.
- `cortexReadSection: null on a CLEAN read (no vetoes, no opposes)` — never fabricates a
  "Cortex is fine" line on a supportive/clean commit.
- `cortexReadSection: renders 'Cortex read' citing the pinned narrative when Cortex actually
  opposed/vetoed the position` — RED before the fix (function didn't exist / field wasn't wired),
  GREEN after.
- `cortexReadSection: falls back to a constructed summary when narrative is empty but
  vetoes/opposes exist` — the honest-degradation path.

`npx tsc --noEmit` clean. `play-brief-intel.test.ts` 85/85 pass. Full `npm test` (Node 20) green,
no regressions.
