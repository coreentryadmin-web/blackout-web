## Vector `vector-terminal-lines.ts` — whole module dead, never wired into any component — FIXED

> **kind:** `FINDING`

| **Status** | Fixed in PR (fix/vector-dead-terminal-lines) |
|---|---|

**Symptom:** none live — pure dead code found during a routine DISCOVERY-lane sweep, not a
production defect.

**Root cause:** `buildVectorTerminalLines` (`vector-terminal-lines.ts`, the file's only export) was
a fully implemented `VectorWallEvent → PlayTerminalLine[]` builder with its own icon/tone maps for
every wall-event kind. The only other `PlayTerminalLine` producer in Vector, `VectorPulse.tsx`,
builds its lines via a completely different function — `buildPlaybookTerminalLines`, SPX
playbook-shadow based — so this wall-event variant was fully written but never wired into any
component.

**Evidence:** `grep -rn "buildVectorTerminalLines\|vector-terminal-lines" --include=*.ts
--include=*.tsx src scripts` → only the file's own definition and its own direct test, before the
fix. No component imported this module.

**Fix:** Deleted `vector-terminal-lines.ts` and `vector-terminal-lines.test.ts` entirely —
`buildVectorTerminalLines` was the file's only export, so nothing else was orphaned by removing the
whole module.

**Fix rationale:** Whole-file deletion rather than trimming, since the file had no other export to
preserve.

**Blast radius:** `src/features/vector/lib/vector-terminal-lines.ts`,
`src/features/vector/lib/vector-terminal-lines.test.ts` (both deleted) only. Confirmed no barrel
file (`src/features/vector/index.ts`) re-exported anything from this module.

**Regression guard:** `tsc --noEmit` clean (confirms nothing else referenced the deleted module).
