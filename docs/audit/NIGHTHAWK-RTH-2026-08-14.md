# 2026-08-14 SESSION — RTH CAMPAIGN (consolidated)

> **SCRATCHPAD ROLLBACK — TWICE.** The doc reverted to 926 lines before BOTH the 17:33 and 18:33
> firings (losing the 15:33/16:33 entries, then the restored set again). Burst script lost both
> times; node20 survived both. Entries for 15:33/16:33/17:33 below are **TRANSCRIBED from session
> context, not re-measured**. The 18:33 entry is freshly measured. A copy of this block is mirrored
> to `docs/audit/NIGHTHAWK-RTH-2026-08-14.md` in the repo working tree — the scratchpad is not
> durable across firings.

## §2 — 15:33 UTC [TRANSCRIBED]
Validator `{PASS:35, INFO:5}` 0 FAIL. 20 live setups, 2 ledger (NBIS 4.50->4.60; RDDT 3.63->1.69
−53%). Track 27W/21L 56%. Burst 7 passes: setups 64->60, spot 776.11->776.34, flip
774.96->777.43->775.39, netgex 11.73->12.08B, regime flapped. Walls 775/765, MP 770. Marks static —
CORRECT, both rows CLOSED. **4 of 6 items from the 08-13 close queue shipped today** (ARM false
positive + validator fix #2160, change_pct 4 sites #2161 verified COHERENT in RTH, force-cap
measured RTH p95 13-15s vs 55s cap -> cap UNCHANGED, validator sampling #2160).

## §2 — 16:33 UTC [TRANSCRIBED]
Validator `{PASS:35, INFO:6}` 0 FAIL. 63 setups. **NEW COMMIT SNDK** (ledger 2->3). Swing lane:
**KKR +188.6% TRIM**, IBIT +44.7% TRIM, RVMD +5.2% HOLD (peak +57.5% given back), FHN −2.1%,
TSM/INTC fresh. ZERO_DTE 1 committed (NBIS 65->71). LEAPS 0/0.

## §2 — 17:33 UTC [TRANSCRIBED]
Validator `{PASS:40, INFO:3}` 0 FAIL. Ledger 4, all CLOSED: SNDK 44.50->22.10 **−50.3% (stop)**,
**MP NEW**, NBIS +2.2%, RDDT −53.4%. 30-day losses 88->89. Regime long, stable.

## §2 — Capture 18:33 UTC (13:36-13:52 ET, ~4.5h into RTH) — MEASURED

**Validator (17:36 UTC): `{"PASS":44,"INFO":3}` — 0 FAIL. Best PASS count of the campaign.**
Live setups sampled (BW 10.5c, TSLA 340c, BLSH 25p) all resolved in Polygon, underlying within
0.09-0.49%. **MP now fully verified**: entry 0.53 vs Polygon option range [0.04, 0.57], mark 0.28 =
**−47.2%** (approaching but not at the −50% stop). Ledger steady at 4, all CLOSED. Track 27W/21L
56%. Malformed 0/11.

Burst 5 usable passes 17:37-17:42: setups 82->84->**19**, as_of advancing 17:34:58 -> 17:40:32 ->
17:41:58, spot 775.68->775.56, flip 774.65-774.71, netgex 13.42->13.05B, regime **long** (stable,
no flapping this hour), walls 775/765, MP 770. Marks static (all rows CLOSED — correct).
**MALFORMED: clean.** FRESHNESS: **LIVE**.

## §3 — updates

- **[P2, REPRODUCED TWICE, mechanism narrowed] Truncated scan roster ~19-20 vs ~82-84.**
  Second catch this hour, same signature and again with a distinct `as_of`:
  ```
  16:56  82 (as_of 16:53:12) -> 20 (as_of 16:56:26) -> 84 (as_of 17:57:49)
  17:41  84 (as_of 17:40:32) -> 19 (as_of 17:41:58)
  ```
  **New detail: the truncated value is consistently ~19-20, never random.** That points at a fixed
  limit rather than lossy truncation. **Hypothesis (UNTESTED): the short pass is PIN-ONLY.**
  `src/lib/zerodte/pin-discovery.ts:76` defines `PIN_EVAL_CAP = 20` — a pass where FLOW and
  BREAKOUT both return empty (upstream hiccup / governor / heat gate) would leave exactly the PIN
  roster, capped at 20. That would make this a *discovery-availability* event surfacing as a
  shrunken board, not a serialization bug.
  **Test that settles it (post-close, or next firing with a fresh auth budget):** poll the board at
  5s, and when `setups.length < 40` dump the per-setup origin distribution — if the truncated
  payload is 100% PIN, the hypothesis is confirmed. Attempted at 17:50 but the session was
  FAPI-rate-limited (20 consecutive 401s) after three mints in the hour; no data. The probe's guard
  correctly labelled them `(auth, not product)`.
  Member impact unchanged: ~75% of the board vanishes for ~1 min, then returns.
- **[HARNESS] Clerk auth budget is ~2 mints/hour in practice.** Validator + burst + a third probe
  exhausted it (20 straight 401s at 17:50). Plan each firing for at most two authenticated runs;
  the third will fail and, without the guard, would look like a product outage.
- Carried unchanged: swing trim asymmetry (RVMD), `horizons` totals ignoring SWING (latent, no UI
  consumer), SPX matrix band alternation / net-GEX ±14%.
