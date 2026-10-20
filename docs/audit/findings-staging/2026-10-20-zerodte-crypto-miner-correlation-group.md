## 2026-10-20 — [FINDING, P2 Night Hawk 0DTE] No bitcoin-miner correlation group — same-direction crypto concentration never capped — FIXED

> **kind:** FINDING

**Context.** Member live-book audit directive: "verify... correlated exposure... don't
dismiss this as normal chop." Investigating today's open 0DTE book (several positions down
-20% to -34%) surfaced a concentration gap the governor's own enforcement history should have
already closed, but never did.

**Root cause.** `governor.ts`'s `CORRELATION_GROUPS` — the static list `concentrationReasonForCandidate`/
`freezeConcentrationState` use to cap same-direction correlated exposure
(`GOVERNOR_MAX_CORRELATED_SAME_DIR = 2`, `GOVERNOR_ENFORCE_CONCENTRATION` default ON) — had
exactly five groups: broad index/ETF, semiconductors, mega-cap tech, tech/enterprise,
financials. **No crypto/bitcoin-miner group existed at all**, despite the file's own standing
comment literally citing *"the 2026-07-30 session... a real P0/P1 incident (14 losers / 1
winner) where unmeasured same-direction concentration was one of five named contributing root
causes"* as **the reason concentration enforcement was flipped on by default** — that comment
names a crypto cluster incident as motivation, yet the group list was never actually extended
to cover one.

**Live evidence (same day, 2026-10-20).** RIOT and HUT both flagged LONG at the identical
instant (`first_flagged_at: 2026-10-20T14:42:09.000Z`), BTDR five minutes later
(`14:47:14.000Z`) — all three open simultaneously, all LONG, none sharing a correlation group
with any other, so the concentration cap never saw them as related at all. MARA and CLSK were
also LONG earlier the same session (both closed winners). At the point the 15:12Z audit check
ran, 3 of the day's 8 worst open drawdowns were RIOT (-30 to -36%), HUT (-21 to -26%), BTDR
(-23 to -35%) — a real same-direction correlated cluster the governor exists specifically to
catch, uncapped.

**Fix.** Added a sixth `CORRELATION_GROUPS` entry: `RIOT, MARA, CLSK, HUT, BTDR, CIFR, WULF,
CORZ, BITF, IREN` — the core publicly-traded bitcoin miners, whose operating economics (hash
price, power cost, BTC-denominated revenue) co-move on BTC spot even more tightly intraday
than the existing sector pairs. Deliberately scoped to miners only — NOT exchanges
(`COIN`) or treasury-holding names (`MSTR`, `SBET`), which are BTC-exposed but a structurally
different business and a separate, larger judgment call — same "narrowest precedented
addition" discipline the TQQQ/SQQQ fix (`FINDINGS.md`) used for the broad-index group rather
than extending it wholesale.

**Precedent for shipping without a dedicated backtest.** The four EXISTING sector-pair groups
(semiconductors/mega-cap tech/tech-enterprise/financials) were themselves added by domain
judgment during a broad audit pass (`FINDINGS.md`, "Wave A/B strongest-engines hardening",
item 11), not from an individual backtest per group — this fix follows the identical,
already-established pattern, on stronger motivating evidence (today's live 3-wide cluster)
than most of the four it joins.

**Blast radius.** `CORRELATION_GROUPS` is also the shared source for the SWING theme-cluster
resolver (`src/lib/swing/theme-cluster.ts`'s own comment: "the ONE correlation-group source
instead of hand-copying the index/ETF list") — verified `theme-cluster.test.ts` (28/28) still
passes unchanged; the new group is purely additive to that consumer too. `CONCENTRATION_POLICY_VERSION`
left at `v2` — the policy's own counting/grouping LOGIC is unchanged, only the group
membership list grew, same as every prior sector-pair addition (which also didn't bump it).

**Evidence of fix.** `src/lib/zerodte/governor.test.ts`: two new tests — `correlationGroupOf`
resolves RIOT/HUT/BTDR/MARA/CLSK to the same new group (and confirms COIN/MSTR stay
unscoped, `null`); `freezeConcentrationState` on a third same-direction miner candidate now
reports `same_beta_open_count: 2`, meeting/exceeding `GOVERNOR_MAX_CORRELATED_SAME_DIR`. Full
file: 60/60 pass (was 58). `theme-cluster.test.ts`: 28/28 pass, unchanged. `tsc --noEmit`
clean.

**What was deliberately left unchanged.** This only affects FUTURE commits going forward
(the concentration check runs at commit time) — it does not touch any currently-open position
or any exit/risk-management behavior. No separate real-cost backtest was run for this specific
addition (see "Precedent" above for why that bar hasn't applied to any prior group addition
either); if the operator wants this group measured before enforcement the same way Q9's
same-direction concentration measure itself was ("measured first... enforced... evidence-
driven" per this file's own history), that is a natural, scoped follow-up, not a blocker to
shipping a fix for an already-incomplete, already-precedented list.
