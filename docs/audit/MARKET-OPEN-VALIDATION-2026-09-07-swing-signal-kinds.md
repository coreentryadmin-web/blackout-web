## 2026-09-07 — swing thesis-health signalKinds wiring (`fix/swing-thesis-health-signal-kinds-wiring`)

- **What was broken:** Committed OPEN swing positions never carried `signalKinds` into `computeSwingThesisHealth`, so Ask Largo "Signal stack" pillar always read `"no signals"` even when the commit dossier had grounded FLOW/STRUCTURE/CATALYST pillars.
- **What changed:** `livePlayFromSwingPosition()` now derives `signalKinds` from `pil_flow` / `pil_structure` / `pil_catalyst` on the pinned `feature_vector` (same honesty rule as #4481's `pil_regime` → `regime`).
- **RTH check:** On an OPEN committed swing (e.g. NRG/CG from the standing Largo audit set), open Ask Largo → Thesis health → "Signal stack" should show `FLOW`, `STRUCTURE`, or `FLOW+STRUCTURE` (not `"no signals"`) when the position's dossier grounded those pillars at commit. Aggregate % may still be withheld (`thesisHealthUncalibrated`) until setupState/entryStatus are wired — that is expected.
