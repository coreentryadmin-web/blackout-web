> **kind:** FINDING

## RTH deep audit P0 oracle post-close: desk session vs Polygon prev — FIXED

| | |
|---|---|
| **Symptom** | `audit` on `main` @ `abc4f901` (Wed 16:02 ET): P0 `[oracle] SPX: desk 7683.82 vs Polygon prev-close 7568.92 (Δ 1.518% > 1.5% tol)` |
| **Root cause** | Nov 2 fix wired off-hours oracle to `I:SPX/prev`, but after the 16:00 ET close Polygon `marketstatus` is closed while desk snapshot still reflects **today's session**. Prev agg is **prior session** close — on a ≥1.5% day that is an apples-to-oranges false P0 (not a data bug). |
| **Fix** | Full-site deep audit oracle runs **only when Polygon reports market open**; otherwise explicit skip pass. |
| **Status** | FIXED |
