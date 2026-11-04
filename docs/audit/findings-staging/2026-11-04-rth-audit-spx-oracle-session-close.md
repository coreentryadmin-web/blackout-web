> **kind:** FINDING

## RTH deep audit P0 — off-hours SPX oracle vs prior close on big move days

| **Status** | FIXED (PR pending) |

**Symptom:** RTH deep audit on `main` @ `abc4f901` failed P0: `desk 7683.82 vs Polygon prev-close 7568.92 (Δ 1.518% > 1.5% tol)` at ~4:02 PM ET.

**Root cause:** Off-hours oracle compared desk **spot** (today’s session level) to Polygon **`/prev`** (prior session close). After a >1.5% SPX day that delta is the real daily return, not a grounding error.

**Fix:** Off-hours, prefer today’s `I:SPX` daily bar close (`session-close`, 0.3% tol); fall back to `/prev` only when no bar yet.

**Verify:** Re-run RTH deep audit after a large index day — oracle should PASS when desk aligns with same-day Polygon close.
