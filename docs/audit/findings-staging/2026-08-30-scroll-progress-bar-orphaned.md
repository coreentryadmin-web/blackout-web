## 2026-08-30 — [FINDING, P4 dead-code] `ScrollProgressBar.tsx` is a fully-built, never-wired-in component — OPEN, write-up only

> **kind:** `FINDING`

| Field | Detail |
|---|---|
| **Symptom** | `src/components/ScrollProgressBar.tsx` is a complete, exported `"use client"` framer-motion scroll-progress-bar component. Repo-wide grep for `ScrollProgressBar` matches only its own definition file — nothing imports or renders it. |
| **Timeline** | `git log --follow` shows it landed 2026-06-17 in a single "Redesign landing page with cinematic animations and glass UI" commit and has not been touched since — over two months orphaned as of this writing (2026-08-30). |
| **Why this is flagged rather than fixed directly** | Unlike a dead re-export (see the companion `2026-08-30-nav-auth-links-dead-reexport.md` entry, fixed in the same sweep), this is a real, non-trivial, UI-facing component. Removing it destroys built work if it was meant to be wired in later; leaving it is silent dead weight if it was abandoned. Per this lane's standing policy ("write up bigger findings/enhancements rather than unilaterally building/removing them"), the call belongs to whoever owns the landing page, not to an unattended sweep. |
| **Contrast checked in the same sweep** | `src/components/render/DealersLadderBackground.tsx` is a similarly large, similarly zero-importer component, but carries an explicit design-intent comment block ("the ONE sanctioned ambient loop in the motion system") that reads as an intentionally built-ahead, documented extension point — NOT flagged as dead code for that reason. `ScrollProgressBar.tsx` has no equivalent comment explaining why it's being kept unwired. |
| **Recommended next step** | Either wire it into the landing page it was built for (if a scroll-progress affordance is still wanted) or delete it — either way needs a decision, not a guess, from the landing-page owner. |
| **Status** | OPEN — flagged for owner decision, no code change made |
