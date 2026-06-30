# SPX Play Engine Monitor — rolling status log

Watches for the known P0: engine generates APPROVE_BUY / A-grade evals but **zero plays ever open**
(root cause was `spx-play-engine.ts:726` `optionTicket.blocked && playOptionChainRequired()` vetoing every open).

**Endpoint note (SKILL paths are stale):** `www/api/market/spx-evaluate` and `www/api/market/spx-plays` both
404. Correct live routes are `GET /api/market/spx/play` (eval snapshot, auth = Bearer CRON_SECRET via apex)
and `GET /api/market/spx/outcomes` (opened/closed plays). Use host `https://blackouttrades.com` (apex), not `www`.
Eval response fields are `available / action / direction / grade / score / confidence / gates / option_ticket`
(not `signal / canOpen / blocked`). Outcomes returns `{ stats, adaptive, rows[] }`.

## 2026-06-30 00:00 ET (first run of new day, overnight)
- Market: **CLOSED** (Tuesday 00:00 ET, pre-RTH; RTH opens 09:30). Both endpoints HTTP 200 (apex + Bearer, local .env.local secret). Eval: action=SCANNING, available=false, session_phase=closed, grade=C, score=53, confidence=96, direction=long; open_play=null; gates.passed=false ("Session closed"); `option_ticket.blocked` absent (no veto) — expected idle state.
- Plays opened (ET today 2026-06-30): **0** — expected, market closed/pre-open, NOT an alert. Prior session 2026-06-29 (Mon) RTH opened **3** plays (outcomes 200; rows=3, total_closed=3, win_rate=0) — engine IS opening plays; open-veto P0 confirmed not regressed.
- Bug pattern (A-grade eval + 0 opens + 30min into RTH): **NO** — outside RTH. Verdict: **GREEN**. Committing as first run of 2026-06-30.

## 2026-06-29 23:55 ET (overnight re-check)
- Market: **CLOSED** (RTH ended 16:00 ET; Monday, ~866 min since 09:30 open). Both endpoints HTTP 200 (apex + Bearer, local .env.local secret). Eval: action=SCANNING, available=false, session_phase=closed, grade=C, score=65, direction=long; open_play=null; `option_ticket.blocked` empty (no veto) — expected idle state.
- Plays opened (RTH 2026-06-29): **3** (outcomes 200; rows=3, total_closed=3, win_rate=0). Unchanged.
- Bug pattern (A-grade eval + 0 opens + 30min into RTH): **NO** — engine opened 3 plays during RTH; 0 post-close opens is expected. Verdict: **GREEN** — open-veto P0 not regressed. No commit (today already logged, no P0).

## 2026-06-29 23:50 ET (overnight re-check)
- Market: **CLOSED** (RTH ended 16:00 ET; Monday, ~860 min since 09:30 open). Both endpoints HTTP 200 (apex + Bearer, local .env.local 44-char secret). Eval: action=SCANNING, available=false, session_phase=closed, grade=C, score=65, direction=long; open_play=null; gates.passed=false; `option_ticket.blocked` empty (no veto) — expected idle state.
- Plays opened (RTH 2026-06-29): **3** (outcomes 200; rows=3, total_closed=3, win_rate=0). Rows unchanged: A+ long 7430.90→7423.75 STOP (−7.15); A long 7435.05→7432.58 THESIS (−2.47); A+ long 7432.13→7439.43 THESIS (**+7.30, still mislabeled loss**).
- Bug pattern (A-grade eval + 0 opens + 30min into RTH): **NO** — engine opened 3 plays during RTH; 0 post-close opens is expected. Verdict: **GREEN** — open-veto P0 not regressed. id=3 win/loss mislabel anomaly still present (tracked separately, out of scope). No commit (today already logged, no P0).

## 2026-06-29 23:47 ET (overnight re-check)
- Market: **CLOSED** (RTH ended 16:00 ET; Monday, ~857 min since 09:30 open). Both endpoints HTTP 200 (apex + Bearer, local .env.local secret authed; Railway CLI unavailable this run). Eval: action=SCANNING, available=false, session_phase=closed, grade=C, score=65, direction=long; open_play=null; gates.passed=false ("Session closed"); `option_ticket.blocked` empty (no veto) — expected idle state.
- Plays opened (RTH 2026-06-29): **3** (outcomes 200; rows=3, total_closed=3, win_rate=0). Re-pulled row detail: A+ long 7430.90→7423.75 STOP (−7.15); A long 7435.05→7432.58 THESIS (−2.47); A+ long 7432.13→7439.43 THESIS (**+7.30, still mislabeled loss**). Unchanged since 23:41.
- Bug pattern (A-grade eval + 0 opens + 30min into RTH): **NO** — engine opened 3 plays during RTH; 0 post-close opens is expected. Verdict: **GREEN** — open-veto P0 not regressed. No commit (today already logged, no P0).

## 2026-06-29 23:26–23:41 ET (3 overnight re-checks, consolidated)
- Market **CLOSED** throughout — every run: eval action=SCANNING, available=false, session_phase=closed/SCANNING, grade=C (score 63), confidence=96, direction=long; open_play=null; gates.passed=false ("Session closed"); `option_ticket.blocked` empty (no veto). Plays opened (RTH 2026-06-29): **3** (outcomes 200; total_closed=3, win_rate=0) — unchanged. id=3 (18:25Z) +7.30pt long still mislabeled `loss` (out of scope, flagged). Bug pattern: **NO**. Verdict: **GREEN** throughout. No commits (not first run, no P0).

## 2026-06-29 23:15 ET (overnight re-check)
- Market: **CLOSED** (RTH ended 16:00 ET; Monday). Both endpoints HTTP 200 (apex + Bearer). Eval: action=SCANNING, available=false, session_phase=closed, grade=C, score=63, confidence=96, direction=long; open_play=null; option_ticket=null (no veto); gates.passed=false (block "Session closed"). Expected idle state.
- Plays opened (RTH 2026-06-29): **3** (outcomes 200; rows=3, total_closed=3, win_rate=0). Unchanged. Rows: A+ cold_buy 7430.90→7423.75 STOP (−7.15); A watch_promote 7435.05→7432.58 THESIS (−2.47); A+ watch_promote 7432.13→7439.43 THESIS (**+7.30, still mislabeled loss**).
- Bug pattern (A-grade eval + 0 opens + 30min into RTH): **NO** — engine opened 3 plays during RTH; 0 post-close opens is expected. Verdict: **GREEN** — open-veto P0 not regressed. No commit (not first run of day, no P0).

## 2026-06-29 23:09 ET (overnight re-check)
- Market: **CLOSED** (RTH ended 16:00 ET; Monday). Both endpoints HTTP 200 (apex + Bearer). Eval: action=SCANNING, available=false, session_phase=closed, grade=C, score=63, direction=long; open_play=null; `option_ticket.blocked` empty (no veto); gates.passed=false. Expected idle state.
- Plays opened (RTH 2026-06-29): **3** (outcomes 200; rows=3, total_closed=3, win_rate=0). Unchanged.
- Bug pattern (A-grade eval + 0 opens + 30min into RTH): **NO** — engine opened 3 plays during RTH. Verdict: **GREEN** — open-veto P0 not regressed. (Eval timed out once at 15s, cleared on 30s retry — cold-start, not a fault.) No commit (not first run of day, no P0).

## 2026-06-29 23:03 ET (overnight re-check)
- Market: **CLOSED** (RTH ended 16:00 ET; ~813 min since 09:30 open; Monday). Both endpoints HTTP 200 (apex + Bearer, local .env.local secret authed).
- Eval: action=SCANNING, available=false, session_phase=closed, grade=C, score=63, direction (long); open_play=null; `option_ticket.blocked` empty (no veto); gates.passed=false. Expected idle state.
- Plays opened (RTH 2026-06-29): **3** (outcomes 200; rows=3, total_closed=3, win_rate=0). Unchanged.
- Bug pattern (A-grade eval + 0 opens + 30min into RTH): **NO** — engine opened 3 plays during RTH; 0 new post-close opens is expected. Verdict: **GREEN** — open-veto P0 not regressed.
- Out-of-scope: the +7.30pt winning long still labeled `outcome=loss` (win_rate=0) — outcome-labeling anomaly already spawned earlier, not re-spawned. No commit (not first run of day, no P0).

## 2026-06-29 22:13–22:58 ET (8 overnight re-checks, consolidated)
- Market **CLOSED** throughout — every run: eval action=SCANNING, available=false, session_phase=closed, grade=C (score 63–65, confidence 96), direction=long; open_play=null; `option_ticket.blocked` empty/null (no veto); gates.passed=false (block "Session closed"). Expected idle state.
- Plays opened (RTH 2026-06-29): **3** (outcomes 200; rows=3, total_closed=3, win_rate=0) — unchanged every run. Rows: A+ long 7430.90→7423.75 STOP (−7.15); A long 7435.05→7432.58 THESIS (−2.47); A+ long 7432.13→7439.43 THESIS (**+7.30, mislabeled loss**). Entry paths: 1× cold_buy, 2× watch_promote.
- Bug pattern: **NO** every run. Verdict: **GREEN** throughout — open-veto P0 not regressed. The +7.30pt winning-long-as-loss labeling anomaly remains out of monitor scope (follow-up already spawned, not re-spawned). No commits (not first run of day, no P0).

## 2026-06-29 21:57 ET (overnight re-check)
- Market: **CLOSED** (RTH ended 16:00 ET ~357 min ago). Outcomes endpoint 200 OK; eval endpoint hung on this run (cold-start, >2m) — not retried since post-close state is known-idle and non-diagnostic for the P0.
- Plays opened (RTH session 2026-06-29): **3** (outcomes 200; total rows=3, stats.total_closed=3). Unchanged.
- Bug pattern (A-grade eval + 0 opens + 30min into RTH): **NO** — engine opened 3 plays during today's RTH; 0 new opens post-close is expected. Verdict: **GREEN** — open-veto P0 not regressed.

## 2026-06-29 21:13–21:43 ET (4 overnight re-checks, consolidated)
- Market **CLOSED** throughout — eval action=SCANNING, available=false, grade=C, session_phase=closed, open_play=null, option_ticket.blocked=(empty/post-close), gates.passed=false. Plays opened (RTH 2026-06-29): **3** (outcomes 200; total_closed=3, win_rate=0). Bug pattern: **NO**. Verdict: **GREEN** throughout. (One cold-start eval timeout cleared on retry; clock reports ET-as-UTC but substance unaffected.)

## 2026-06-29 20:49 ET (post-close re-check)
- Market: **CLOSED** — eval action=SCANNING, available=false, grade=C, session_phase=closed, option_ticket.blocked=(empty/post-close). Expected idle state.
- Plays opened today: **3** (outcomes 200 OK; stats.total_closed=3, win_rate=0). Unchanged from 17:01 entry.
- Bug pattern: **NO** — engine opened plays during RTH; not RTH now so 0-opens would be normal anyway.
- Note: eval endpoint timed out on first attempt (12s), succeeded on retry (25s) — cold-start latency, not a fault. Verdict: **GREEN**.

## 2026-06-29 17:01 ET (first run of day)
- Market: **CLOSED** (RTH ended 16:00 ET) — engine idle, this is post-close.
- Eval: action=**SCANNING**, available=false, grade=B, confidence=96, direction=long
- Plays opened today: **3** (all RTH, all closed) — `cold_buy` A+ @13:20 ET, `watch_promote` A @13:55 ET, `watch_promote` A+ @14:25 ET
- Bug pattern (APPROVE_BUY + 0 opens 30min+ into RTH): **NO** — execution is working, plays opened & closed normally.
- Today's record: 0W / 3L (`stats.total_closed`=3). Performance is poor today but that is a strategy/P&L concern, not the open-veto bug this monitor guards.

**Verdict: GREEN.** The "never opens" P0 is resolved/not regressed — the engine opened 3 plays during today's RTH. This confirms the pending-items Monday-RTH verification ("SPX plays open").

## 2026-06-29 17:31 ET (anomaly detail, post-close)
- Verified all 3 outcome rows, pnl_pts recomputed (exit−entry) on every row: id=1 −7.15 STOP, id=2 −2.47 THESIS, id=3 **+7.30** THESIS.
- ⚠️ **Data-correctness anomaly (out of scope, follow-up task spawned):** id=3 is a **+7.30pt winning long** (exit 7439.43 > entry 7432.13) yet labeled `outcome=loss` → `stats.overall.win_rate=0` when true rate is ≥1/3. This corrupts `computeAdaptiveGates(stats)` calibration. Likely the win/loss classifier keys off "hit target" not pnl sign (id=3 exited on THESIS before target 7446.13).

## 2026-06-29 17:09–18:11 ET (14 post-close re-checks, consolidated)
- Ran `GET /api/market/spx/play` + `/api/market/spx/outcomes` (apex + Bearer) every ~5 min. All identical and frozen since the 17:01 first run.
- Eval each time: action=SCANNING, available=false, session_phase=closed, grade=A, score=81, confidence=96, direction=long; gates.passed=false (block "Session closed"); `open_play`=null; `option_ticket.blocked`=null (no veto). Plays opened today: **3** (all closed, 0W/3L). Bug pattern: **NO** (post-close, 0 new opens is expected).
- Two transient curl HTTP 000/timeout blips, each cleared on immediate retry (endpoint healthy).
- Verdict: GREEN throughout. No commits (not first run, no P0).

## 2026-06-29 23:22 ET (late post-close check)
- `GET /api/market/spx/play` + `/api/market/spx/outcomes` (apex + Bearer) both HTTP 200.
- Eval: action=SCANNING, available=false, session_phase=closed, grade=C, score=63, confidence=96, direction=long; gates.passed=false (block "Session closed"); `open_play`=null; `option_ticket`=null (no veto). thesis="Desk offline · resumes 6:30 AM PT".
- Plays opened today: **3** (session_date 2026-06-29, all closed, 0W/3L). Bug pattern (APPROVE_BUY + 0 opens 30min+ into RTH): **NO** — market closed, 0 new opens is expected; open-veto bug remains resolved.
- ⚠️ id=3 win/loss mislabel anomaly still present (+7.30pt long, exit 7439.43 > entry 7432.13, labeled `loss`; win_rate=0). Tracked separately — strategy/data-correctness concern, not this monitor's open-veto guard.
- Verdict: GREEN. No P0. Not first run of the day, no alert → no commit.
