> **kind:** FINDING

## Learn / Night Hawk guide still said "overnight playbook" — FIXED

| **Status** | Fixed in PR (learn article title, meta, image alt, instrument guide description) |
| **Severity** | P2 marketing consistency |
| **Surface** | `/learn/night-hawk-evening-edition-guide`, learn instrument guide |

**Symptom:** Homepage module carousel still served stale hawk `lede` from pre-manifest deploy, and the Evening Edition learn article title/meta/alt text still said "overnight playbook" after the canonical manifest banned that phrase.

**Fix:** Retitle article to "Prep for the Next Session", update meta/alt copy to 0DTE Command + Evening Edition framing, align `night-hawk.ts` guide description. Regression test in `no-execution-claims.test.ts`.
