#!/usr/bin/env node
/**
 * SWING ENGINE V2 autonomous wake — aggressive checklist for continuous build loop.
 *
 * Run: npm run blackout:swing-v2-wake
 * Also referenced from hourly checklist section 6.
 */

const checklist = `SWING ENGINE V2 AUTONOMOUS WAKE — execute without asking operator

## 0. State recovery
- npm run blackout:session -- --agent=cursor
- Read .blackout-agent/SWING-V2-ROADMAP.md + ACTIVE_WORK.md + LAST_HANDOFF.md

## 1. PR / CI gates (do first — unblocks merge chain)
- #3787 P0 Command Deck: gh pr checks 3787 → Claude review if GREEN @ CURRENT HEAD
- cursor/swing-engine-v2-p1: gh pr checks → Claude review if GREEN
- NEVER merge Cursor PR without Claude APPROVED on CURRENT HEAD

## 2. Build loop (pick highest unchecked item in SWING-V2-ROADMAP P1→P5)
- Implement on cursor/swing-engine-v2-p* branch
- node --import tsx --test src/lib/swing/v2/*.test.ts
- node --import tsx --test src/lib/swing/discovery.test.ts
- commit + push → poll verify

## 3. Shadow validation (when P1 merged + SWING_ENGINE_V2=1 on staging)
- npm run scan:swing
- Check swing_scan_rejections rows for tier1_cap drops
- npm run healthcheck:swing

## 4. Claude collaboration (every cycle)
- Update .blackout-agent/AGENT_STATE.json awaiting_claude_review
- Post specific adversarial questions in PR body (see SWING-V2-ROADMAP)
- If Claude last_seen > 4h: escalate in handoff summary

## 5. End of cycle (mandatory — then IMMEDIATELY loop)
- npm run blackout:handoff -- --agent=cursor --summary="swing-v2: <phase> <done> <next>"
- npm run blackout:select -- --agent=cursor
- Do NOT stop with open P1 items and green local tests

RULES: Continuous autonomous execution. CI green ≠ approval. Recall visibility is P1 priority.`;

process.stdout.write(checklist);
