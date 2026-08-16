# Vector deep UI audit — 2026-08-16

Live audit of the `/vector` desk on **production**, driven as a signed-in member through the
CONNECT-tunnel Chromium. Scope: everything Cursor shipped recently — the bead-rail toggles
(#2239–#2242), the drawing tools (#2216/#2217/#2220/#2223), compare mode (#2213/#2215/#2225/#2227),
the zoom fixes (#2221/#2222), candle rendering (#2209/#2211), the GEX ladder and the matrix rail —
plus every other control on the desk.

**Market phase: WEEKEND.** The tape is closed, so live values are legitimately static. Nothing in
this report treats an unchanging number as a staleness bug, and no such claim should be quoted from
it. A re-run during RTH is required before any "values do/don't update live" conclusion.

**Auth:** one temp Clerk admin+premium user per run, deleted in a `finally`. Read-only throughout —
no member data written, no ledger touched. Drawings created during the audit are stored per browser
profile and die with the ephemeral context.

---

## Headline

**No Vector product defect was reproduced.** Every feature tested works. Five separate
"findings" surfaced during the audit and **all five turned out to be defects in my own harness** —
they are documented below in full, because the harness traps are reusable knowledge and because a
report that hides its false starts cannot be trusted about its real ones.

Two genuine, low-severity observations survive (§3), plus one environmental note (§4).

---

## 1. What was verified working

Live, on prod, desktop 1440×900 unless noted.

| Area | Controls exercised | Result |
|---|---|---|
| **Lens** | GEX ⇄ VEX | `aria-pressed` flips both ways; chart re-renders; no console errors |
| **DTE** | 0DTE / Weekly / Monthly | all three toggle; state flips; chart survives |
| **Bead rail (#2239–#2242)** | Rings, $ Size, Events | all three toggle and restore; **Rings correctly `disabled` under the VEX lens** (integrity is GEX-scored — the chip does not lie about a ring the lens cannot draw) |
| **Drawing tools (#2216/#2223)** | hline, trend, ray, rect, text, fib, vline | **7/7 create a drawing** (isolated) and **5/5 in sequence**; ink counter increments per drawing |
| **Text tool** | label input + placement | `vector-draw-text-input` appears on tool select, accepts typing, reads back correctly, places on chart click |
| **Undo / persistence** | Undo, reload | undo removes **exactly one**; **drawings survive a full page reload** (per-ticker store) |
| **Chart views** | Intraday / 4H / 1D / 1W | all four toggle cleanly |
| **Zoom presets** | Session / Structure / Live | all three toggle cleanly |
| **Wheel zoom (#2221/#2222)** | 6× in, 6× out | completes with **zero console errors** — the regression those PRs fixed did not reappear |
| **Indicators** | menu open | all 9 entries present: VWAP, EMA (9·21·50), SMA (50·200), Floor pivots (P/R/S), RSI (14), MACD (12/26/9), EM cone, Session, Nearest flip |
| **Ticker search** | type `NVDA` → select | returns an option and **switches the desk** (`?ticker=NVDA`) |
| **Ticker search** | type `ZZZZQQ` (nonsense) | no crash, no console error |
| **Compare (#2215/#2225)** | enter compare | renders panes (7 canvases on a clean load) |
| **Matrix rail** | ALL / CALL / PUT, reset-to-spot | all clean |
| **Layout** | desktop | **no horizontal overflow** (scrollWidth == clientWidth == 1440) |
| **Page load** | `/vector?ticker=SPY` | 11 canvases, **0 console errors, 0 page errors** on a clean load |

---

## 2. Five false findings — what my harness got wrong

Recorded deliberately. Each one looked like a product bug and was not.

### 2.1 "21 controls are broken" — expired Clerk session
The first full run reported 21 P2 findings. Cause: a Clerk session JWT lives **~72 seconds**; the
sweep runs for many minutes. Once it expired, the page's own fetches returned **401** and every
control touched after that point read as broken.
**Fix:** a 45s keep-alive that re-mints via `session.refresh()` and re-seeds the browser context
cookies. After it: **0 harness noise**.

### 2.2 "Six controls never receive clicks" — hidden duplicate testids
Six controls reported `click never landed`, with diagnostics showing a **0×0 element at 0,0**.
Cause: the desk renders **both** a desktop toolbar and an `ios-compact-scroll-row` copy. **7 of 12
probed testids exist twice**, and the compact copy — `display:none` on desktop — comes **first in
the DOM**, so Playwright's `.first()` resolved to the hidden twin.
**Fix:** `:visible` on every locator. Measured by `vector-testid-probe.mjs` before anything was
written up. (See §3.1 — the duplication itself is a real, minor finding.)

### 2.3 "trend / rect / fib don't draw" — wrong gesture, then a self-inflicted click steal
Reported three times across three revisions. Two distinct harness errors stacked:
1. Drawings are placed from **chart CLICK events** (`vector-draw-click.ts` → `resolveChartClickTime`),
   not drags. A `mousedown → move → mouseup` never delivers the first point.
2. Even with two clicks, the **tool panel overlays the chart** and swallows one of them unless it is
   re-opened between the two points.
The tell was the pattern: failures were **every other tool** by loop position (indices 1,3,5) —
an alternation, which is a state artifact, not three independent bugs.
**Proof:** `vector-draw-isolate.mjs` → **7/7** tools draw when tested one per page load.
`vector-draw-sequence.mjs` → **5/5** draw in a row with the corrected gesture.

### 2.4 "Compare mode renders nothing" — judged on a broken page
Compare was tested immediately after a ticker switch that had hit a transient chunk 404 (§4). It was
being judged on a page whose JS had already failed to load.
**Fix:** compare now gets its own fresh navigation. On a clean page it renders panes normally.

### 2.5 Draw-gesture coordinate collision
An early revision drew every tool at the same y, so the `trend` drag began exactly on the `hline`
drawn seconds earlier and **moved it** instead of creating anything. Fixed by staggering each tool
into its own horizontal band — though §2.3 turned out to be the dominant cause.

---

## 3. Genuine findings

### 3.1 [P3, test hygiene] Seven `data-testid` values are duplicated in the DOM
`vector-dte-0dte`, `vector-dte-weekly`, `vector-dte-monthly`, `vector-draw-tools-trigger`,
`vector-indicator-trigger`, `vector-enter-compare`, `vector-ticker-search` and
`vector-draw-toolbar` each resolve to **2 elements**: one inside a hidden
`div.vector-toolbar-row-primary/secondary.ios-compact-scroll-row`, one laid out. The hidden copy is
**first in DOM order**.

Any E2E selector using these testids without a visibility filter silently grabs the unclickable
twin. The repo has already paid for this once — #2238 ("vector E2E uses desk toolbar role locators")
looks like exactly this workaround.

**Suggested fix:** scope the testid to the rendered variant (e.g. suffix the compact copy
`-compact`), so a testid means one element. Not urgent; no member impact.

### 3.2 [P3] React hydration error #418 on the Vector desk
```
Minified React error #418  (args[]=HTML)
```
Observed twice, after a reload with the drawing panel open. React #418 is a hydration mismatch —
server-rendered HTML disagreeing with the first client render. No visible breakage followed it and
the desk stayed functional, but hydration mismatches make React discard and re-render the subtree,
which costs exactly the interactivity budget a live chart desk cares about.

**Not root-caused.** Needs a non-minified build or a `?__nextDevOverlay` style repro to name the
offending node.

---

## 4. Environmental note — transient chunk 404s were self-inflicted

Two runs logged `404` + `Refused to execute script … MIME type ('text/plain')` for
`_next/static/chunks/{1878,6431,webpack}-*.js`.

**All three return HTTP 200 with `content-type: application/javascript` when re-checked.** The
window matches the production deploys triggered by **my own merges earlier in this session**
(#2242 at ~08:15Z, #2243 at ~08:57Z) — during an ECS rollout an already-loaded client requests
chunk hashes the new revision no longer serves.

This is **not a Vector defect and not a Cursor regression.** It is, however, a real member-facing
behaviour worth its own ticket: a member with the desk open when a deploy lands can get a broken
page until they reload. The usual mitigations are keeping the previous build's chunks alive for a
grace period, or detecting a chunk-load error client-side and prompting a reload.

---

## 5. Coverage still outstanding

Stated plainly rather than implied — this audit did **not** cover:

- **RTH re-run.** Everything here is weekend-phase. Live tick/bead/mark dynamism is untested.
- **Multi-ticker sweep** (NVDA, TSLA, SPX, QQQ) — in flight when this was written.
- **Phone viewport** (430×932) — the `ios-compact` toolbar in §2.2/§3.1 is exactly the surface a
  phone pass would exercise, and it is untested.
- **Replay controls**, **alerts panel** (Notify me / alert type / tolerance), **Helix rail**,
  **play card**, **regime banner** — present in the inventory, not yet driven.
- **Compare depth**: 4-up panes, per-pane overlays, sync-zoom across panes (#2213/#2215).
- **Drawing colours** (`vector-draw-color-*`) and **delete-selected**.
- **Pixel/visual regression** — this audit asserts behaviour and console health, not appearance.

---

## Harnesses (committed with this report)

| Script | Purpose |
|---|---|
| `scripts/audit/vector-deep-ui-audit.mjs` | control discovery — enumerate every visible control, role, testid |
| `scripts/audit/vector-deep-interact.mjs` | the sweep — toggles, tools, indicators, zoom, search, compare, layout |
| `scripts/audit/vector-testid-probe.mjs` | testid duplication + which copy is laid out |
| `scripts/audit/vector-draw-isolate.mjs` | one drawing tool per page load |
| `scripts/audit/vector-draw-sequence.mjs` | several drawings in a row, ink counted after every click |

Run from the repo root with `NODE_USE_ENV_PROXY=1`. All read-only; each deletes its temp Clerk user
in a `finally`.
