> **kind:** FINDING

## Largo Concrete mode (the default answer mode) never rendered `envelope.systemReads` — FIXED

| **Status** | FIXED (`fix/largo-concrete-systemreads`) |
|---|---|

### Root cause

`src/features/largo/answer/LargoConcreteAnswer.tsx` is the Talon-style "verdict + one dense
paragraph" renderer and is the **default** `answerMode` in `LargoAnswerMessage.tsx` — the renderer
the overwhelming majority of real chat answers go through. `envelope.systemReads` (documented in
`src/lib/bie/answer-envelope.ts`: "What each product independently thinks about this instrument,
plus the cross-system agreement tally. Built from the tool results the turn ALREADY fetched... —
one row is not a consensus") is populated by `system-reads-extract.ts` purely off which tools the
turn called (gated on >=2 systems consulted), completely independently of whether the model also
wrote any canonical `sections`/`levels` prose describing that consensus.

`LargoConcreteAnswer.tsx` never imported or read `envelope.systemReads` at all — not behind a
flag, not conditionally, the field simply never appeared in the component. Every sibling renderer
already handles it:
- `LargoDeskRead.tsx` (Deep dive mode) renders `envelope.systemReads.reads` directly as a
  "System reads" block (`largo-read-signals`).
- `BieAnswer.tsx` (the not-rich-enough/no-envelope fallback renderer) was fixed the same day in
  PR #7717 to render it via a new `BieSystemReadsPanel` component.

So a turn that genuinely cross-checked multiple desks (e.g. Helix bullish on net call flow,
Thermal bearish on dealer short gamma) and computed a real agreement/disagreement tally lost that
structured, already-fetched cross-product read outright, for every answer that reached a member
through the default Concrete mode — which is most of them.

### Evidence

Before the fix, rendering `LargoConcreteAnswer` with an envelope carrying a populated
`systemReads.reads` array (two systems, split verdict) produced:

```
<article class="largo-concrete-answer">...<p class="largo-concrete-verdict">SPX holding the flip.</p>
<div class="largo-message-body ...">...</div></article>
```

— no "System reads" text, no system names, nothing. The field was silently absorbed and dropped.
Regression test `LargoConcreteAnswer surfaces envelope.systemReads` in
`LargoConcreteAnswer.test.ts` fails with exactly this (confirmed RED: reverted the component change
locally, re-ran the test, got `AssertionError: The input did not match /System reads/`), and passes
once the `BieSystemReadsPanel` render call is restored (confirmed GREEN).

### Blast radius

Single call site: `LargoConcreteAnswer.tsx` is the only remaining renderer in
`src/features/largo/answer/` that read `unavailableSources`/`gexShifts` but not `systemReads` (the
`gexShifts` gap in the same file is a separate, already-open fix in PR #7719 — this PR is
additive to that one, not a duplicate). No other consumer of `envelope.systemReads` exists outside
this directory (grep confirmed: `LargoDeskRead.tsx`, `BieAnswer.tsx`, `BieSystemReadsPanel.tsx`,
`index.ts`, and the type definition in `answer-envelope.ts` are the only other hits).

### Fix rationale

Reused the existing `BieSystemReadsPanel` component verbatim (already null-safe — returns `null`
when `systemReads`/`reads` is absent or empty, so no extra guard needed at the call site) rather
than reimplementing the "System reads" block a third time, exactly mirroring how `BieAnswer.tsx`
was fixed for the identical gap the same day. Placed the render call right after the
`unavailableSources` chip block and before `LargoMessageBody`, matching the vertical order
`BieAnswer.tsx` uses for its own structured-data blocks (evidence → levels → ladder → scenarios →
gexShifts → systemReads → body). Deliberately left unchanged: `gexShifts` in this same file (a
separate, already-open PR #7719) and the Concrete-mode `evidence` rendering question (a genuine
design-intent judgment call, not a clear bug — left for a future round to resolve explicitly).

### Files touched

- `src/features/largo/answer/LargoConcreteAnswer.tsx` — import + render `BieSystemReadsPanel`.
- `src/features/largo/answer/LargoConcreteAnswer.test.ts` — two new regression tests (renders with
  systemReads present; renders nothing extra when absent).
