## 2026-10-12 — [FINDING, P3 Learn/content-accuracy] Largo's Learn copy understated its own tool count by ~2x ("~70+" vs the real 138) — FIXED
> **kind:** `FINDING`

| **Area** | **Severity** | **Status** |
|---|---|---|
| Learn content (guide + 2 articles) | P3 — understated, member-facing credibility, no functional impact | FIXED |

**What's wrong.** Three Learn copy locations claimed Largo has roughly 70 backend tools:
- `src/lib/learn/guides/instruments/largo-ai.ts:98` — *"Maps to ~70+ backend tools in
  LARGO_TOOL_DEFS..."*
- `src/lib/learn/articles.ts:1806` (`largo-ai-terminal-guide`) — *"...over **70 tools** in
  total."*
- `src/lib/learn/articles.ts:1840` (`largo-ai-market-analysis-tips`) — *"Largo AI has access to
  over **70 live data tools**..."*

The real registry (`src/lib/largo/tool-defs.ts`'s `LARGO_TOOL_DEFS`) has **138 unique tools**
today — confirmed two independent ways: a source-text regex count of every `t("...")` call inside
the array (138, zero duplicate names), and importing the real array live and reading
`.length` (also 138). No test anywhere pinned this number to the Learn copy, so it drifted
silently as tools were added without the Learn pages being swept.

**Fix.** Updated all three copy locations from "~70+"/"over 70" to "~130+"/"over 130" — a
conservative floor below today's real count of 138, matching the exact under-promise convention
the original "~70+" already used (presumably also a deliberate floor when first written, just one
that was never revisited as the registry grew).

**Regression guard.** New `src/lib/learn/largo-tool-count.test.ts`: asserts `LARGO_TOOL_DEFS.length`
clears a 130 floor, and that each of the three copy claims (extracted from the real guide/article
content via regex, not hardcoded in the test) never exceeds the live `LARGO_TOOL_DEFS.length`. This
guards the dangerous direction of drift going forward — Largo's Learn pages promising MORE tools
than actually exist — and needs no future edits as the registry keeps growing, as long as it stays
above 130.

**Honest limitation on the RED→GREEN proof.** This test shape cannot retroactively prove today's
specific fix via a failing pre-fix test: the original bug was an *understatement* (70 tools
claimed, 138 real), and a "does the copy ever overstate the real count" check passes on 70 ≤ 138
just as readily as on 130 ≤ 138 — the direction of today's bug isn't the direction this guard
catches. Confirmed directly via `git stash` on the two content files: all 4 new tests still pass
against the pre-fix copy. This is the same limitation documented on the FAQ `member-1` price-token
fix earlier this session (`2026-10-12-faq-member1-hardcoded-prices.md`) — todays's bug was caught by
directly counting the real registry (twice, independently), not by a failing regression test; the
test's real job is preventing the *opposite*, more dangerous drift (an overstated tool count) from
now on.

**Verification.** `tsc --noEmit` clean. `npx tsx --experimental-test-module-mocks --test
src/lib/learn/*.test.ts` — 46/46 pass (full Learn test directory). `src/lib/largo/tool-defs.test.ts`
— 54/54 pass, unaffected.

**Blast radius.** The three copy strings + the new test file only. No change to
`LARGO_TOOL_DEFS` itself or any Largo runtime behavior.

Found via a background Explore-agent sweep of Learn article/guide content accuracy, independently
re-verified (recounted `LARGO_TOOL_DEFS` two separate ways — regex and a live import — getting an
identical 138 both times) before fixing. The same sweep also surfaced a second, lower-confidence
finding (Night Hawk's "five ranked rows" claim possibly contradicting its own guide's
table-redesign description) that needs the owning Night Hawk lane to confirm the real current row
count before any copy change — not fixed here, reported separately rather than guessed at.
