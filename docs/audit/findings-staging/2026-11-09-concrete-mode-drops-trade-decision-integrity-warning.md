> **kind:** FINDING

## Ask Largo "Concrete" mode (the default) silently drops the `tradeDecision` not-on-board / board-play integrity warning — FIXED

| **Status** | Fixed in this PR |
|---|---|

### Root cause

`src/lib/largo/core/decision-read.ts` defines `TradeSupplement` (carried on the envelope as
`envelope.tradeDecision`) with this header comment:

> TRADE SUPPLEMENT — integrity badges and board context ONLY. ... This object adds
> **non-negotiable honesty flags** (spot hold, not on board, edition vs ledger) without replacing
> what the model wrote for this specific question.

In particular `notOnBoardWarning` fires when a member asks a play-style question about a ticker
that is **not** committed on the live 0DTE board — the exact case where a member could otherwise
mistake a speculative, model-authored read for a real, tracked position. `boardPlay` and
`existingPlay` likewise disclose when a board/edition play already exists for the ticker so a
fresh model answer doesn't contradict it silently.

`src/features/largo/components/LargoAnswerMessage.tsx` has three rendering branches selected by
`answerMode` and envelope richness:

1. **Concrete mode** (`answerMode === "concrete"`, **the default** — see
   `LargoAnswerMessage`'s own default parameter and `LargoTerminal.tsx`'s
   `answerMode={msg.depth === "deep" ? "deep" : "concrete"}`) → `LargoConcreteAnswer`.
2. **Deep dive mode** and the envelope clears its own `richEnough` bar → `LargoDeskRead`.
3. Deep dive mode but not rich enough, or no envelope at all → `BieAnswer`.

Only `LargoDeskRead.tsx` ever read `envelope.tradeDecision` — it builds `integrityNotes` from
`trade.notOnBoardWarning` / `trade.boardPlay` / `trade.existingPlay` and renders them in a
dedicated `.largo-read-integrity` strip. `LargoConcreteAnswer.tsx` (branch 1, the **default** a
member sees on every turn unless they explicitly tap into Deep dive) and `BieAnswer.tsx` (branch
3) never reference `tradeDecision` at all — confirmed by grep, zero hits in either file.

**Consequence:** a flag its own source comment calls "non-negotiable" was, in practice, fully
conditional on a UI toggle most members never touch — it only ever reached the page if a member
(a) manually switched to Deep dive **and** (b) the same envelope happened to clear an unrelated
richness bar (`headline`/`bias` present AND at least one of `levels`/`sections`/`tradeDecision`).
For the overwhelming majority of real turns — the default Concrete experience — a member asking
about a ticker with no committed board play saw the model's prose with no integrity disclosure at
all, exactly the outcome `TradeSupplement`'s own header comment says must never happen. This is
the same "multiple parallel rendering branches, one missing a field the others have" bug class as
#7702/#7704, this time the opposite direction: the field is missing from the **default** branch,
not the Deep-dive one.

### Evidence

Reproduced with `react-dom/server`'s `renderToStaticMarkup` against the real, unmocked
`LargoConcreteAnswer` component (`src/features/largo/answer/concrete-trade-integrity.test.ts`):

- **RED (pre-fix, confirmed via `git stash` on just `LargoConcreteAnswer.tsx`):** rendering
  `<LargoConcreteAnswer envelope={envelopeWithTradeDecisionWarning}>` produced HTML with the
  verdict and body but **no** occurrence of the `notOnBoardWarning` text, and no `boardPlay`/
  `existingPlay` notes either — 2 of 3 tests failed.
- **GREEN (post-fix):** the same render now contains the warning text and the `Board: .../
  Edition: ...` notes; a third test confirms an envelope with no `tradeDecision` renders no extra
  markup (`.largo-read-integrity` absent) — no regression for the common case.
- Full related suite (`src/features/largo/components/*.test.ts`,
  `src/features/largo/answer/*.test.ts`, `src/lib/largo/core/*.test.ts`): 403/403 pass.
  `tsc --noEmit`: clean.

### Blast radius

Only `LargoConcreteAnswer.tsx` needed a change. `LargoDeskRead.tsx`'s own `integrityNotes`
construction and the `.largo-read-integrity`/`.largo-read-integrity-note` CSS classes
(`src/app/globals.css`) were already correct and are reused byte-for-byte rather than duplicated
or reinvented — the fix produces the identical note text and `note` lines regardless of which
renderer a given turn takes. `BieAnswer.tsx` (branch 3, reached only when Deep dive is active AND
the envelope misses the richness bar) still does not render `tradeDecision`; left out of this PR's
scope to keep it single-issue — flagged below as a follow-up, not silently left broken without
comment.

### Fix rationale

Added the same `integrityNotes` construction `LargoDeskRead.tsx` already uses
(`notOnBoardWarning` / `boardPlay` / `existingPlay`) directly to `LargoConcreteAnswer`, rendered
between the verdict and the body using the **existing** `.largo-read-integrity` /
`.largo-read-integrity-note` classes (no new CSS needed, and the member sees visually consistent
chrome whether a turn renders through Concrete or Deep dive). Placed after the verdict line and
before the prose body to match `LargoDeskRead`'s own ordering intent (integrity flags accompany,
never bury, the verdict). Did not touch `LargoDeskRead.tsx`'s logic, the envelope type, or
`decision-read.ts`'s construction — this is purely a missing wire in one of three renderers, the
same shape of fix as #7704.

### Follow-up (not fixed here, flagged for a future round)

`BieAnswer.tsx` (branch 3 — Deep dive mode with a not-rich-enough envelope, or no envelope at all)
also never reads `envelope.tradeDecision`. In practice this branch is reached less often (it
requires Deep dive mode specifically), but the same "non-negotiable" comment applies regardless of
mode — a future round could wire the same `integrityNotes` block into `BieAnswer.tsx` for full
coverage across all three branches.

### Market-open validation

See `docs/audit/MARKET-OPEN-VALIDATION.md` — once the market opens, ask Ask Largo (in the default
Concrete mode, no toggle) about a ticker that is NOT currently committed on the live 0DTE board
(e.g. a random mid-cap with no open 0DTE play) and confirm the "not on board / speculative" note
now renders under the verdict — it did not render in Concrete mode before this fix.
