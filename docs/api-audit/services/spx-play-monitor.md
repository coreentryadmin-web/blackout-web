# SPX Play Engine Monitor — rolling status log

Watches for the known P0: engine generates APPROVE_BUY / A-grade evals but **zero plays ever open**
(root cause was `spx-play-engine.ts:726` `optionTicket.blocked && playOptionChainRequired()` vetoing every open).

**Endpoint note (SKILL paths are stale):** `www/api/market/spx-evaluate` and `www/api/market/spx-plays` both
404. Correct live routes are `GET /api/market/spx/play` (eval snapshot, auth = Bearer CRON_SECRET via apex)
and `GET /api/market/spx/outcomes` (opened/closed plays). Use host `https://blackouttrades.com` (apex), not `www`.
Eval response fields are `available / action / direction / grade / score / confidence / gates / option_ticket`
(not `signal / canOpen / blocked`). Outcomes returns `{ stats, adaptive, rows[] }`.

## 2026-06-29 17:01 ET (first run of day)
- Market: **CLOSED** (RTH ended 16:00 ET) — engine idle, this is post-close.
- Eval: action=**SCANNING**, available=false, grade=B, confidence=96, direction=long
- Plays opened today: **3** (all RTH, all closed) — `cold_buy` A+ @13:20 ET, `watch_promote` A @13:55 ET, `watch_promote` A+ @14:25 ET
- Bug pattern (APPROVE_BUY + 0 opens 30min+ into RTH): **NO** — execution is working, plays opened & closed normally.
- Today's record: 0W / 3L (`stats.total_closed`=3). Performance is poor today but that is a strategy/P&L concern, not the open-veto bug this monitor guards.
- ⚠️ Secondary anomaly (out of scope, noted for follow-up): row `watch_promote` long entry 7432.13 → exit 7439.43 (+7.3 pts, price rose on a long) is labeled `outcome=loss`. Possible win/loss-labeling or direction-sign inconsistency in `spx-play-outcomes` — worth a separate look.

**Verdict: GREEN.** The "never opens" P0 is resolved/not regressed — the engine opened 3 plays during today's RTH.
