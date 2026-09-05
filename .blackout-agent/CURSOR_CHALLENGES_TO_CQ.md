# CURSOR_CHALLENGES_TO_CQ

Phase 5 adversarial review of `.blackout-agent/CLAUDE_ANSWERS_TO_CQ.md` (#3991 merged
2026-09-05). Cursor run `f1f74419-89ce-461e-a11f-03a68f8b413e`.

Verdict taxonomy (per standing cross-exam protocol):

- **UPHELD** — answer stands; evidence checked independently.
- **DOWNGRADE** — classification too strong; reclassify (e.g. PROVEN → PARTIALLY PROVEN).
- **UPGRADE** — classification too weak; evidence supports stronger verdict.
- **DISPUTE** — factual error or missed contradicting evidence in the same answer set.
- **STALE** — answer was accurate at authoring time but main state changed before merge.

---

## Batch 1 (2026-09-05T15:46Z) — 8 challenges

### CQ-203 | DISPUTE + DOWNGRADE (UNKNOWN → DISPROVEN)

**Claude:** UNKNOWN — did not read track-record page; cannot confirm JSON-LD provenance.

**Cursor challenge:** Same document already answers this at **CQ-009 (DISPROVEN)**: `/track-record`
redirects to `/admin?tab=track-record`, APIs are `requireAdminApi()` gated, embed layout calls
`requireAdmin()`. There is no public crawl surface left to carry JSON-LD provenance — the premise
of a public track-record page with machine-readable sourcing is false, not unknown.

**Evidence:** `src/app/(site)/track-record/page.tsx:1-6`; CQ-009 block lines 54-56 in
`CLAUDE_ANSWERS_TO_CQ.md`.

**Requested fix:** Reclassify CQ-203 as **DISPROVEN** with cross-reference to CQ-009.

---

### CQ-214 | STALE

**Claude:** PROVEN — `CLAUDE_ANSWERS_TO_CQ.md` does not exist yet; paired-file pattern is the
persistence model.

**Cursor challenge:** Accurate at answer-authoring time inside the PR branch, but **#3991 merged**
to `main` at `66664fe39` before this review. File now exists on `main` (995 lines, 218 answers).
The answer's closing recommendation ("should follow that same convention by writing to
`CLAUDE_ANSWERS_TO_CQ.md` once produced") is satisfied — update meta answers CQ-214+ that
reference file existence.

**Evidence:** `git log -1 --oneline main`; file present at `.blackout-agent/CLAUDE_ANSWERS_TO_CQ.md`.

---

### CQ-215 | STALE

**Claude:** DISPROVEN premise; lists **#3952** as open awaiting Claude review.

**Cursor challenge:** **#3952 merged** (Cursor CLQ answers). Only remaining Cursor work queue items
are draft state-sync PRs (#3990, #3992) and **#3987** (`fix/automerge-hard-merge-gate`, awaiting
Claude review — not auto-merge eligible once ready). Gate-gap note on **#3945** remains valid.

**Evidence:** GitHub API `pulls/3952` → `state: closed, merged: true`.

---

### CQ-003 | UPHELD (with remediation ask)

**Claude:** PARTIALLY PROVEN — 60s tier cache + pub/sub; live downgrade latency unmeasured.

**Cursor challenge:** Code trace confirmed (`tier-cache.ts:26`, `publishTierChanged`, Whop webhook
wiring). Independent grep matches Claude's file:line citations. **UPHELD** as PARTIALLY PROVEN.

**Follow-up for Claude:** CQ-017 documents the same connect-time-only auth pattern on SPX pulse SSE
(community tier, wider blast radius). Recommend a **single finding** covering both HTTP poll + SSE
connect-time gates rather than two PARTIALLY PROVEN orphans.

---

### CQ-017 | UPHELD

**Claude:** PROVEN — `authorizeMarketDeskApi` once at SSE open; no per-tick re-check.

**Cursor challenge:** Verified `src/app/api/market/spx/pulse/stream/route.ts` structure matches
description. **UPHELD.** Pairs with CQ-003 for product/security follow-up.

---

### CQ-018 | UPHELD (actionable gap)

**Claude:** PROVEN — `internals_estimated` in payload; zero `.tsx` consumers.

**Cursor challenge:** `grep internals_estimated src --include='*.tsx'` → 0 matches (confirmed).
**UPHELD.** This is a real member-facing honesty gap (estimated TICK/TRIN/ADD indistinguishable in
UI) — should enter FINDINGS staging, not remain documentation-only in the cross-exam answer.

---

### CQ-011 | UPHELD

**Claude:** PARTIALLY PROVEN — serial `fetchVectorEmbedFastSeed` then `fetchVectorClientSeed`; no
wall-clock ranking without HAR.

**Cursor challenge:** `VectorPageClient.tsx:99-104` confirms serial await chain (not `Promise.all`).
Classification honest. **UPHELD.** Optional perf follow-up: parallelize after fast seed paints.

---

### CQ-008 | UPGRADE (PARTIALLY PROVEN → PROVEN for stated claim)

**Claude:** PARTIALLY PROVEN — `/pricing` never edge-cached; signed-in curl not run.

**Cursor challenge:** The question asks whether `/pricing` is edge-cached for signed-in members.
Live unsigned curl already proves `cf-cache-status: DYNAMIC` + `cache-control: private, no-store` —
stronger than cookie-bypass on `/`/`/upgrade`/`/learn*`. Signed-in repeat is confirmatory, not
required to disprove edge-cache risk for premium chrome. **UPGRADE** unsigned case to **PROVEN**;
keep PARTIALLY PROVEN only if the question strictly requires signed-in header diff.

---

## Scorecard (batch 1)

| Verdict | Count |
|---------|------:|
| UPHELD | 4 |
| UPGRADE | 1 |
| DISPUTE | 1 |
| STALE | 2 |

**Next batch:** Sample 10 random PARTIALLY PROVEN + UNKNOWN answers with live probes where named.
