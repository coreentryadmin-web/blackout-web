# QA regression library

Owned by the QA / Adversarial Product Testing lane (`docs/agents/briefs/qa-adversarial.md`).
Every meaningful production defect this lane finds becomes a reusable entry here — reproduction
steps, root cause, regression scenario, whether automated coverage exists, and production
verification result. **Check new findings against this file before filing them as novel**; a bug
found once should get harder to reintroduce, not merely fixed once.

This file is edited directly by the QA lane (unlike `docs/audit/FINDINGS.md`, which only the
`findings-fold-staging.mjs` script writes to) — it is QA's own working document, not the shared
fold target. A defect still gets a `docs/audit/findings-staging/` entry too, exactly like every
other lane's findings, so it reaches the coordinator and folds into `FINDINGS.md` on the normal
cadence. This file is the QA-specific index on top of that: "have we seen this shape before."

## How to use this file

- Before filing a new finding, scan the table below for the same product + same failure shape.
- After a defect is fixed and independently re-verified live (per `_COMMON.md` rule 6 — merged is
  not done, deployed is not done), update its row's **Verified** column with the date and result.
- A regression scenario is the SPECIFIC repro that would need to hold for the bug to have
  returned — not "test the page again," but "switch expiry 0DTE → Weekly → back to 0DTE and check
  the wall label," so a future pass can mechanically check for recurrence.

## Format

```
### <PRODUCT> — <short title>

| Field | Detail |
|---|---|
| Severity | P0/P1/P2/P3 |
| Found | YYYY-MM-DD |
| Reproduction | numbered steps |
| Root cause | what was actually broken, and why |
| Regression scenario | the specific repro a future QA pass should re-run |
| Automated coverage | test file + name, or "none yet" |
| Findings-staging entry | link to the `docs/audit/findings-staging/` (or folded `FINDINGS.md`) entry |
| Verified live | date + result of the post-fix production retest, or "pending fix" |
```

---

## Entries

_(none yet — no PRODUCT defect has been confirmed. See "Phase 0 status" below for what has
actually been covered and what is still pending manual verification.)_

---

## Phase 0 status (2026-08-23)

First pass: a broad interaction sweep (`qa-phase0-sweep.mjs`, #2775) followed by an exhaustive
per-element interaction pass (`qa-phase0-deep.mjs`, #2781/#2782/#2787) per the brief's correction
that a route merely navigated-to-and-screenshotted is not a route that was tested.

**Routes covered with the deep (exhaustive per-element) harness, desktop viewport:**

| Route | Product | Result |
|---|---|---|
| `/nighthawk` | Night Hawk | Clean (0 findings) after harness fixes |
| `/heatmap` | Thermal | Clean (0 P0-P3, 1 correctly-classified HARNESS) after harness fixes |
| `/vector` | Vector | Clean (0 P0-P2); 1 P3 flagged for manual verification (below) |
| `/meridian` | Meridian | Clean (0 P0-P2) — full clean end-to-end pass blocked by concurrent production deploys during testing, not a product issue; the specific bug the pass targeted (content-fingerprint blindness) was independently verified fixed via direct repro |
| `/dashboard` | SPX Slayer (+ embedded Largo) | Clean (0 P0-P2); 3 P3s flagged for manual verification (below) |
| `/terminal` | Largo | Clean (0 findings) |
| `/flows` | Helix | Clean (0 findings) via the shallower sweep; not yet run through the deep harness |
| `/` (home) | — | Clean (0 P0-P2) via the shallower sweep |

**Not yet covered:** mobile viewport for every route above; `/pricing`, `/faq`, `/upgrade`,
`/learn`, `/about`, `/track-record` (the shallow sweep hit severe proxy-tunnel saturation on these
and reported `HARNESS`, never actually judged — see #2775's PR description).

**Every defect the deep harness surfaced this pass turned out to be a bug in the harness itself**
(8 found and fixed — false-empty from unsettled pages, false active-tab counts across independent
tablists, a content-fingerprint that never reached dynamic content past a long static prefix, a
select test that reselected its own current value, and related timing/scoping issues). Full root
cause, live evidence, and fix for each is in #2781, #2782, and #2787's PR descriptions — not
duplicated here. No PRODUCT defect has been confirmed in this pass.

### Items flagged for manual/product-lane verification — not confirmed, not dismissed

These surfaced live but the harness could not get confident, reproducible evidence either way
(documented in #2782 and #2787). Routing here rather than filing as confirmed findings, per the
brief's evidentiary standard — flagging honestly rather than asserting past what was actually
verified:

1. **Vector (`/vector`) — ticker search box.** Typed "SPY" into the "Search any stock symbol"
   input; it read back "SPX" (the previously-active ticker) after Enter. Two direct follow-up
   probes of the same input even disagreed on whether it was present/visible at that moment,
   consistent with a collapsed/expanding combobox rather than an always-open text field — plausibly
   correct "revert to last confirmed symbol on unselected Enter" behavior, not a bug. Needs a human
   (or a combobox-aware harness) to drive the actual autocomplete flow and confirm which it is.
2. **SPX Slayer (`/dashboard`) — "Largo" tab.** Clicking the embedded Largo tab reported no visible
   content change within the harness's poll window (~5.3s), but a direct follow-up probe found a
   real change (body text 39,731 → 40,946 characters) — the panel likely just settles slower than
   polled (chat/async content). Needs confirmation the Largo panel actually finishes loading in a
   reasonable time for a real member, not just that it eventually changes.
3. **SPX Slayer (`/dashboard`) — two unlabeled selects** (timeframe: `1/3/5/15/30/60/custom`; a
   second with `auto/6/8/12/16/20`, likely a row-count control). Both selects's own values updated
   correctly, but the panel's visible content didn't change within the poll window. Could be the
   same slow-settle pattern as the Largo tab, or the affected panel may not be in the
   currently-visible tab when tested. Also worth separately noting: both selects carry no
   accessible name (`aria-label` empty, `name` empty) — worth a small a11y fix regardless of the
   content-change question.

### Harness limitations tracked, not yet solved

- **Mid-interaction rollout resilience.** The settle-poll fix (#2782) only guards the
  pre-interaction window; a deploy landing mid-interaction-pass (observed 3x live against
  `/meridian` during this session, from concurrent fleet activity) still corrupts that run's
  console/network error counts. A full fix would need every interaction step, not just navigation,
  to detect and recover from a self-triggered reload.
- **Combobox-style inputs.** `testSearch` assumes a plain text field where typed text + Enter
  commits literally. Vector's ticker field (and likely others) is a collapsed/expanding combobox —
  needs its own interaction model (open trigger, type, select from a `role=listbox`/`role=option`
  list) rather than being treated as a generic text input.
