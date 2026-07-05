# SPX end-to-end audit fixes (2026-07-05)

Branch: `cursor/spx-audit-fixes-9d1e`

## P1 fixed

| ID | Fix |
|----|-----|
| C1 | Commentary loads server desk on cache miss; client body ignored |
| C2 | JSON parse failure returns null (502), never ungrounded raw text |
| M1 | `gex-heatmap` + explain use `requireAnyToolApi(["spx","heatmap"])`; bootstrap seeds matrix SWR |
| L1 | `isLottoPollWindow()` through 2 PM ET; `useSpxLotto` polls until intraday cutoff |
| D1 | Power hour WATCH Discord uses `action: "WATCH"` |

## P2 fixed

- `gex-positioning`: `no-store` headers; gate includes `spx`
- `spx-play-gates.test.ts` added
- `noEntryCutoffLabel()` early-close aware
- `spx-evaluate` skip message 16:15 ET
- Matrix grey text → cyan/sky palette; basic grid a11y
- Power hour member UI: `GET /spx/power-hour` + dock block
- `superseded` excluded from win-rate stats
- DB cleanup retention for shadow observations, engine snapshots, lotto_plays
- `AGENTS.md` doc drift (SpxGexMatrixHeatmap)
