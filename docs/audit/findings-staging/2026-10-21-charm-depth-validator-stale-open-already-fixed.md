## 2026-10-21 — [FINDING, stale-OPEN correction] "No CHARM depth validator sibling" finding — fixed, a separate FIXED entry already exists, original OPEN status never updated

> **kind:** `FINDING`

| | |
|---|---|
| **What this corrects** | `docs/audit/FINDINGS.md`'s 2026-09-05 entry **"No CHARM depth validator sibling to `gex-depth-validate.mjs` — OPEN"** (P2 observability, Cursor 360° cross-exam CLQ-017) |
| **Status** | FIXED (offline phase) — a separate entry already in this same file documents the fix; this entry corrects the original's stale status line |

**What actually happened.** The recommended fix — a CHARM-side sibling to
`scripts/audit/gex-depth-validate.mjs` — was built and shipped: `scripts/audit/
charm-depth-validate.mjs` + `scripts/audit/charm-depth-validate.test.mjs` both exist on `main`
today, confirmed via `find . -iname '*charm-depth*'`. A **second, separate** FINDINGS.md entry —
**"No CHARM depth validator sibling to `gex-depth-validate.mjs` — FIXED (offline phase)"** — already
documents this fix in full (offline grid validating `charmPerShare()` against an independent
Black-Scholes finite-difference, 2/2 regression tests, live-chain cross-check explicitly deferred
as a separate smaller follow-up). The ORIGINAL 2026-09-05 entry, however, was never itself updated
from OPEN to FIXED or pointed at the later entry — both now sit in the same file describing the
same root cause with contradictory status.

**Why this is worth a correction, not just a duplicate-noise shrug.** A reader scanning for OPEN
P2s would hit the stale entry and reasonably conclude this is still unaddressed work, when the
addressable half (the offline validator) shipped — only the explicitly-deferred live-chain
cross-check genuinely remains open, and that's already named as a deliberate follow-up in the
FIXED entry, not a gap this correction needs to re-raise.

**No code changed, no gate touched.** Documentation-only correction, same convention as the two
prior stale-OPEN corrections filed this session (ThermalCompareStrip, heavy-cron-pool skip-rate;
the sharedCacheSetNx and shadow-expiry-intrinsic ones were both corrected in earlier cycles).
