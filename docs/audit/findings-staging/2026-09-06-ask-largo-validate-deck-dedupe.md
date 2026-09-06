# Ask Largo swing validate harness — deck dedupe assertions

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **Status** | FIXED |
| **Area** | audit harness / Night Hawk Swings |
| **PR** | (this branch) |

## Symptom

`ask-largo-swing-brief-validate.mjs` and `ask-largo-swing-brief-v4-validate.mjs` still expected **Verdict / Management / Thesis health / Position** in the **center-rail panel DOM** after #4150 shipped `envelopeForSwingDeckBrief()`. Once ECS rolled the UI change, the harness would falsely RED on `missing section: Verdict` even though the product fix was correct.

## Root cause

Harness `expectedSections()` conflated **API envelope** (full brief) with **deck panel** (trimmed view). No assertion that duplicate chrome was actually stripped.

## Fix

- Split expectations: `expectedApiSections()` vs `expectedPanelSections()`.
- Assert `DECK_OMIT_PANEL_SECTIONS` absent from panel + empty BieAnswer headline.
- Add `waitFor` on filter bar before click (fixes flaky first-run timeout).

## Verify

```bash
NODE_USE_ENV_PROXY=1 node scripts/audit/ask-largo-swing-brief-v4-validate.mjs
NODE_USE_ENV_PROXY=1 node scripts/audit/ask-largo-swing-brief-validate.mjs
```

Post-#4150 deploy: panel must start at Trade manager read with no Verdict block.
