## 2026-10-11 — [P4, docs] FINDINGS.md inconsistency: "Post-Whop-pay tier lag" (CLQ-041) still listed OPEN despite its own fix having shipped — SUPERSEDED

> **kind:** `FINDING`

| | |
|---|---|
| **Area** | `docs/audit/FINDINGS.md` itself (documentation accuracy, no code change) |
| **Severity** | P4 |
| **Status** | SUPERSEDED |

### What's wrong

`FINDINGS.md` carries two entries for the same real-world issue, with contradicting status:

- **`## 2026-09-05 — [P1, commerce] Post-Whop-pay tier lag — no desk "processing payment" UX —
  OPEN`** — filed by a Cursor 360° cross-exam pass (CLQ-041), status table says `OPEN —
  PARTIALLY PROVEN`.
- **`## Post-Whop-pay tier lag — no desk "processing payment" UX — FIXED (banner + auto-sync)`**
  — same `CLQ-041` tag in its own table, status `FIXED`, describing the real shipped fix:
  `MembershipActivatingBanner` in `AppShellProviders` polls `POST /api/membership/sync` every
  3s (~2 min) when a remembered-plan click is fresh and the Clerk tier is still free, backed by
  `membership-activating.test.ts` (5/5) and `MembershipActivatingBanner.test.ts` (2/2).

Both entries landed in the same fold batch (both anchored near a `## 2026-09-05` dated heading a
few hundred lines apart), so the fix shipped at essentially the same time as the finding was
filed — but the OPEN entry was never updated or cross-referenced to the one that fixed it. A
future session (or a human) reading only the OPEN entry would waste time re-investigating or
re-filing an already-fixed P1 as new — exactly the staleness trap this repo's own CLAUDE.md
warns about repeatedly. Found while independently spot-checking a background sweep agent's
report (which flagged the OPEN entry for awareness without realizing it was already fixed
elsewhere in the same file) rather than taking its "clean" verdict at face value.

### Independent verification

Both files the FIXED entry claims actually exist and match its description:
`src/components/MembershipActivatingBanner.tsx` + `.test.ts`, `src/lib/membership-activating.ts`
+ `.test.ts` — confirmed via direct file listing, not just trusting the FINDINGS.md prose.

### What's genuinely still open

The FIXED entry's own "Deferred" line is accurate and remains true: *"Synthetic upgrade p95
measurement — not run this session."* So the core UX gap (no feedback between payment and tier
activation) is fixed; only the follow-up measurement of how long that banner-poll window
actually runs in practice under real Whop webhook latency is still unmeasured. That is a real,
narrow, separate follow-up — not a reason to treat CLQ-041 as unresolved.

### Resolution

No code changed by this entry — it is a documentation correction only, so the next fold/
reconcile pass and any future reader treats CLQ-041 as resolved (per the FIXED entry) rather
than re-opening or re-investigating it. The original 2026-09-05 OPEN entry is left in place
(per the standing "never edit FINDINGS.md directly, only fold/append" rule) — this entry is the
durable correction note sitting above it in the newest-first file.
