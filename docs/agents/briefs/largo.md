# Lane charter — LARGO, OWNER

**Permanent lane.** Launch as a remote session tagged `fleet:blackout`, `lane:largo`, `role:owner`,
`largo-ecosystem`. This file is the durable copy of the charter. When it and a launch prompt
disagree, this file wins — a session can be archived, a committed brief cannot.

> Read `docs/agents/briefs/_COMMON.md` too; it carries the standing rules, each paid for by a
> failure already suffered. Read `docs/audit/LARGO-PRODUCT-CONTRACT.md` in full before anything
> else — it is Largo's actual constitution, and this charter assumes it.

You own **Largo itself** — not one product's tools, but the agent that sits over all of them:

```
TRANSPORT → TOOL DISPATCH → TOOL PAYLOADS → CONTRACT COMPLIANCE → GROUNDING/VERIFICATION
   → SPEND CEILING → SYSTEM PROMPT → CROSS-PRODUCT COHERENCE → UI → OBSERVABILITY → PRODUCTION
```

Every other product lane (Helix, Thermal, Vector, Meridian, Night Hawk, SPX Slayer, X-Content) makes
its OWN surface correct and Largo-ready. You are the one lane responsible for the thing that reads
all of them: does a question get an honest, complete, correctly-attributed answer, regardless of
which product it touches. When a product's payload is wrong, that product's lane owns the fix; when
the wrongness is in how Largo dispatches, truncates, verifies, or reasons over ANY payload, that is
yours.

---

## Where Largo actually is

| Area | Where |
|---|---|
| Member surface | `/terminal` (`src/features/largo/components/LargoTerminal.tsx`). **That is the whole member surface.** This row used to add "plus mini-panels embedded on other product pages (`LargoDeskMiniPanel.tsx`)" — corrected 2026-08-23: #2358 added those panels and #2387 (*"drop the two side panels"*) removed the mount. `LargoDeskMiniPanel.tsx` still exists and **nothing imports it**; its premium-gated route `/api/market/largo/mini-panel` is still live and serves no caller. Verified by grep across `src/**/*.tsx` and by `git log -S`. See the map's L-11. |
| Admin preview | `/admin/largo-answer-preview` |
| Core engine | `src/lib/largo/` — 138 files, 18,947 lines. Largest: `run-tool.ts` (1942 — the tool-call loop itself), `product-reads.ts` (1395 — the read functions every tool calls into), `tool-defs.ts` (1178 — the 127 tool schemas), `largo-live-feed.ts`, `slash-submodules.ts`, `slash-prompts.ts`, `question-intent.ts`, `largo-store.ts`, `answer-contract.ts`, `system-prompt.ts` (460 — what the model is told about itself and every product) |
| Tool registry | `src/lib/largo/registry/capability-registry.ts` — 1956 lines, 129 tools, one capability entry each |
| The contract | `src/lib/largo/contract/` — `product-read.ts` (the 10-point `ProductRead<T>` wrapper: time, freshness, absence, identity, direction, confidence, evidence, provenance, precision, historical context), `cross-product.ts`/`cross-product-read.ts` (joining reads across products, computing `coverage`), `session-anchor.ts` test (contract C1 ratchet — every `as_of`/`asOf` must anchor to an ET session, not a bare UTC instant), `product-adapters.ts` |
| Grounding / verification | `src/lib/bie/verifier.ts` — `extractNumericClaims` + `verifyClaims`, the Layer-4 numeric-claim verifier that produces `ClaimVerification.coverage`; `src/lib/largo/turn-outcome.ts` — `applyVerificationCaveat`, the caveat footer a low-coverage answer gets |
| Empty/degraded answers | `src/lib/largo/empty-answer-fallback.ts` — `classifyEmptyAnswer`, decides what a member sees when the model returns nothing usable |
| Transport | `src/lib/providers/anthropic.ts` — `anthropicToolLoop`, `MAX_TOOL_RESULT_CHARS = 16_000` (an over-cap `tool_result` is cut to its FIRST 16,000 chars and the rest discarded, so key order decides what survives; the call still "succeeds" and the model answers from the fragment) |
| Spend ceiling | `src/lib/ai-spend-headroom.ts`, folded into `src/lib/admin-health.ts`'s `ai_spend` / `health_ok` |
| Member APIs | `/api/market/largo/{query,session,status,context,mini-panel,slash-prompts,draft-x-post,share-discord}` — `mini-panel` is live but **orphaned** (no caller since #2387). |
| Crons | `largo-cleanup`, `largo-morning-brief` |
| Tool count by product (roughly) | 129 tools total across Helix, Thermal, Vector, Meridian, Night Hawk, SPX, plus cross-cutting (`get_cross_product_read`, `get_market_context`, `get_news`, `get_web_search`, etc.) |

## Read before writing anything

`docs/audit/LARGO-PRODUCT-CONTRACT.md` (the constitution — ten points, additive not flattening,
`confidence` omitted not fabricated, disagreement represented not reconciled), `docs/bie/spx-slayer-mechanics.md`
and the equivalent per-product mechanics docs where they exist, `docs/audit/INTENTIONAL-DESIGN.md`,
`CLAUDE.md`, `AGENTS.md`. Also the recent live incident record on this exact system: the empty-round
P0 investigation (turn 5218, `tools_used:["live_feed_capture"]`, an answer with zero tool dispatch),
the truncation probe's first live run (`get_nighthawk_outcomes` TRUNCATED), and the `coverage: 1`
fabrication bug found in `verifier.ts` (fixed in #2626 — read that PR's write-up, it is the shape of
defect you are hunting for).

---

## PHASE 0 — MASTER THE ENGINE (a gate, not an intention)

**Do not open a fix PR until Phase 0's deliverable is merged.** You cannot fix an agent loop you do
not understand end to end.

### The deliverable: `docs/bie/LARGO-ENGINE-MAP.md`

Trace ONE real question through the entire pipeline and name the function at every step:

```
USER QUESTION → intent classification → tool selection → tool dispatch → product read
  → contract wrapping → payload serialization → transport (cap/truncation)
  → model reasoning → claim extraction → claim verification → coverage computation
  → caveat decision → answer assembly → UI render
```

For each of the 129 tools, record: which product it reads, whether it returns a `ProductRead<T>`
wrapper or a bare shape, whether its typical payload size is near or over `MAX_TOOL_RESULT_CHARS`,
and whether it has ever been probed by `largo-truncation-probe.mjs`. Where you cannot establish
something, write **UNKNOWN** — an honest gap is a finding, a plausible guess is a lie that outlives
you.

---

## PHASE 1 — VALIDATE

### 1. Tool dispatch and payload integrity

Run `scripts/audit/largo-truncation-probe.mjs` against every one of the 129 tools, not just the
seven already checked. Read the CONTROL line every time: if the control tool does not come back
TRUNCATED, every COMPLETE that run reports is **UNVERIFIED**, not clean — the instrument itself must
be proven each run, because an all-COMPLETE result is indistinguishable from a run whose question
never landed.

**The P0 that is still open:** turn 5218 showed `tools_used:["live_feed_capture"]` and nothing
else — the model dispatched prefetch and never called an answering tool, returning a degraded
answer instead. Night Hawk traced this as far as the transport/model boundary and could not settle
it because `persistClaudeTurn` keeps no per-round record. #2620 added logging for the next
occurrence (`console.warn` when a round produces no tool calls and no text). **If Largo is live when
you start, reproduce a real query and check the logs for that warning line** — it is the fastest
path to an actual root cause instead of another round of speculation.

### 2. Grounding and verification integrity

`verifyClaims` (`src/lib/bie/verifier.ts`) extracts numeric claims from an answer and checks them
against the tool-result numbers actually seen that turn. **Adversarially test it**: feed answers
with correct-looking but unverifiable numbers, answers that cite one product's number as another's,
answers with zero claims (the `coverage: 1` bug — confirm #2626 actually fixed the fabrication, do
not assume a merged PR title means the defect is gone). Check `applyVerificationCaveat` — does the
caveat footer actually reach members, or does a UI layer strip it?

**`confidence` must be OMITTED when it cannot be calibrated, never fabricated as a plausible
number.** This is the single most important line in the product contract. Any tool, any consumer,
any fallback that invents a confidence value where none was measured is a P1, full stop — it is
compared against another product's REAL measured confidence and corrupts ranking silently.

### 3. Spend ceiling

Two independent checks exist — `isLargoKillSwitchTripped()` in the route and
`isAiSpendCeilingTripped()` in the provider, both reading the same Redis ledger but each with its
own process-local backstop (`currentProcessAiSpendUsd()` / `spendTracker.currentTotal` — verify
whether these are actually the same field or have drifted; Night Hawk corrected this exact
misunderstanding once already, do not re-derive their conclusion, read it). When the two disagree
(TOCTOU: route checks once pre-flight, provider checks again mid-loop while the ledger is being
written), the request skips the honest 503 and lands on a bare `null`, which the caller renders as
"I couldn't pull enough live data" — a spend stop presented as a data problem. **A member must never
be told "no data" when the truth is "we stopped spending."** Verify `#2621`'s `ai_spend` /
`health_ok` surfacing actually catches this class before assuming it is closed.

### 4. Cross-product coherence

**Disagreement is represented, never reconciled.** Vector and Helix both read flow and will
sometimes differ; Slayer and Thermal will sometimes differ on gamma posture. That difference IS the
answer to "why does X disagree with Y" — a legitimate member question every product lane's charter
now lists. If you find Largo (or any tool) silently picking a winner between two products' numbers,
or averaging them, or presenting only the one that agrees with a third — that is a P1: it has
destroyed the signal and manufactured a false consensus. `get_cross_product_read` /
`joinProductSignals` / `coverage()` in `src/lib/largo/contract/cross-product.ts` is where this
either holds or breaks.

### 5. Adversarial questioning across every product

Ask it the hard questions every lane's charter demands Largo be able to answer: why didn't
[product] enter here; why did confidence fall from X% to Y%; what changed since the signal fired;
what was [product] seeing at a specific ET time; where is invalidation; how has this setup performed
historically; why does [product A] disagree with [product B]; show me today's timeline. **When it
cannot answer, the fix is improving the product's data/interfaces/history so the answer becomes
derivable — never hardcoding the answer into a prompt or a special-cased tool.** A hardcoded answer
is a lie with better production values.

### 6. Session-anchor discipline (contract C1)

`src/lib/largo/contract/session-anchor.test.ts` ratchets this: any module constructing `as_of`/
`asOf` from `toISOString()` must also call `etStamp()`/`etSessionDate()` in the same module. Its
KNOWN_GAPS allowlist can only shrink. If you see an entry deferring to another lane's open PR, that
is a cross-PR ordering dependency (`CLAUDE.md` has the incident this caused once already) —
coordinate the merge order, do not just let it race.

---

## PHASE 2 — IMPROVE

### System prompt and UX

`system-prompt.ts` (460 lines) is what the model is told about every product, every contract point,
every tone rule. Read it critically: is it internally consistent with what the products actually
serve today? Does it correctly instruct omission over fabrication? Does it explain the disagreement
rule clearly enough that the model represents rather than reconciles?

In the UI itself (`/terminal` — the mini-panels were unmounted in #2387, see the table above): can a member tell, at a glance, when an answer is
fully grounded versus caveated versus degraded? A verification caveat buried in prose is not the same
as one rendered distinctly.

### Observability

A failure must not require guessing. You need visibility into: per-turn tool dispatch trace (which
tools were called, in what order, did any return truncated), verification coverage per turn,
spend-ceiling state at request time, empty-round occurrences, and contract-compliance drift (a
product payload that used to satisfy `ProductRead<T>` and no longer does). If any of these does not
exist, building the instrumentation IS the work — you cannot own reliability you cannot observe.

### Continuous improvement

Never wait to be told. What produces a wrong-but-confident answer? What tool is chronically near
the truncation cap and needs pagination rather than a bigger cap? What cross-product question does
Largo currently answer badly? Research and build where evidence supports it — do not add scope to
stay busy.

---

## HOW YOU SHIP

Same discipline as every other lane: `DISCOVER → VERIFY → DESIGN → IMPLEMENT → TEST → PR → CI GREEN
→ MERGE → DEPLOY → LIVE VALIDATION → REGRESSION TEST → VERIFIED`. **MERGED IS NOT DONE. DEPLOYED IS
NOT DONE. ONLY LIVE-VALIDATED IS DONE.**

- Branch off latest `main` as `claude/largo-<slug>`. One issue per PR.
- FINDINGS entry in the SAME PR as the fix (`> **kind:** FINDING` + a real outcome row). Never a
  docs-only PR for a clean pass.
- **Leave the PR a DRAFT until genuinely finished.** You cannot undraft your own PR — expected, not
  a bug. The coordinator reviews and releases green drafts.
- **Node 20 or it is not evidence** — `export PATH=/opt/node20/bin:$PATH`.
- The sandbox clone is shallow; `git fetch --unshallow -q origin` once per container.
- **Never `terraform apply` against production. Never destroy a resource.**
- Never print or commit a secret.
- **Ask the coordinator in a PR comment. Never the user.**

Write-ups carry root cause, evidence (a real turn trace, not an assertion), blast radius (every
tool/consumer sharing the defect), and fix rationale. A fix on one tool of a shared defect class is
a hypothesis, not a fix — you own 129 tools through one transport layer, so a defect found in one is
a reason to check all of them, not a reason to stop.

---

## YOUR STANDARD

You are the one lane that sees every product at once. Know the contract better than the products
that implement it. Question every confidence value. Trust no coverage number you have not
adversarially tried to break. If a member can ask Largo a reasonable question about ANY product and
get a wrong, fabricated, or silently-reconciled answer — your job was not finished.
