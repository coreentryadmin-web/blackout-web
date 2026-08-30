## 2026-08-30 — [FINDING, P4 audit-hygiene] SPX Slayer Largo coverage finding (2026-08-20) — heading/table Status said OPEN while its own blockquote already said FIXED — CORRECTED

> **kind:** `FINDING`

| Field | Detail |
|---|---|
| **What this corrects** | `docs/audit/FINDINGS.md`'s 2026-08-20 entry **"[FINDING, P2 Largo] SPX Slayer Largo — full desk coverage (14 submodules, prefetch, intent) — OPEN PR #2382"** carries an internal contradiction: its own blockquote line directly under the heading reads `> **status:** \`FIXED\` — merged #2382; post-deploy prod audit 69 scenarios: 47 PASS / 20 WARN / 1 FAIL (flaky gate-trace truncation; single-scenario retest PASS)`, but the H2 heading itself still says `OPEN PR #2382` and the entry's own table has a `| **Status** | OPEN — merge + full prod audit after deploy. |` row. The entry documents its own fix AND its own post-deploy verification, then reports itself as still open. |
| **Confirmed via GitHub** | PR #2382 ("SPX Slayer Largo — full desk coverage (14 submodules + audit harness)") is `closed`, `merged: true` — matching the blockquote's "merged #2382" claim. |
| **Why this is a hygiene correction, not a new investigation** | The evidence for FIXED already lives inside the entry itself (69-scenario post-deploy prod audit, 47 PASS / 20 WARN / 1 FAIL with the one FAIL identified as flaky and retested PASS) — this correction doesn't add new evidence, it resolves the entry's heading/table against the status its own blockquote already asserted. Per repo convention, the original entry is left intact rather than edited in place; this dated correction supersedes its heading and Status row. |
| **Action taken** | None to the product — already fixed and already prod-verified per the entry's own text. This entry exists solely so the next `findings-fold-staging.mjs` pass can carry the corrected status forward. |
| **Status** | CORRECTED — the 2026-08-20 SPX Slayer Largo coverage finding is FIXED (was self-contradictory: OPEN heading/table alongside a FIXED blockquote with post-deploy evidence already in hand). |
