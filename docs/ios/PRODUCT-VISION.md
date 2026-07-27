# BLACKOUT — Native iOS Product Vision

> The north-star document for the production-grade **native SwiftUI** BlackOut iOS app.
> Everything here is grounded in the real repository — the desks, the data, and the
> voice already shipped on `blackouttrades.com`. It defines what we are building and,
> just as importantly, what we are refusing to build. It is a vision doc, not a backlog;
> sequencing lives in `docs/ios/EXECUTION-STATE.md` and `docs/ios/IOS-PREMIUM-PROGRAM.md`.

**Provenance.** Product truth is drawn from `src/lib/marketing/products.ts` (the six desks,
their taglines, audiences, and accents), `src/lib/site.ts` (brand, tagline, positioning),
`src/lib/ios-tool-routes.ts` (the in-app tool registry), and the live feature code under
`src/features/{spx,helix,thermal,largo,nighthawk,vector}`. Where a capability exists today,
is partial, or is still missing, this doc says so plainly — it never invents one.

---

## 1. Mission

**Build the app a professional options trader would keep open next to their broker.**

BlackOut is "the institutional options desk, rebuilt for iPhone" — dealer positioning, live
options flow, and 0DTE market structure, "the intelligence layer professional desks pay a
premium for, unified in one command surface" (`src/lib/site.ts`, `docs/ios/ASC-METADATA.md`).
The web product already delivers this. The native iOS app's mission is to make that
intelligence feel **native to the device and native to the decision** — instant, precise,
tactile, and trustworthy in the hand — not to reproduce a website inside a frame.

The brand promise is one line: **"Trade like the lights are on."** (`SITE.tagline`). The app
is the flashlight. It exists to remove the fog around a trade — to show where dealers are
pinned, where flow is committing, and where a thesis breaks — so the trader acts with
conviction instead of guessing in the dark.

The app is explicitly **not a brokerage**: no account to fund, no order routing, no trade ever
placed in the app (`docs/ios/ASC-METADATA.md`, `src/components/OnboardingGuide.tsx`). It
surfaces structure; the trader executes wherever they already trade. That boundary is not a
limitation to hide — it is the product's integrity, and the native app should wear it with
confidence.

---

## 2. The target user — the active options trader

BlackOut is not built for the casual investor checking a portfolio balance. It is built for the
trader who is *in the tape*, making time-sensitive options decisions, and who already knows what
GEX, a sweep, and a flip level are. The product itself names six concrete personas — the
audience chips in `src/lib/marketing/products.ts`:

- **0DTE traders** — SPX Slayer's home crowd; they need structure *before the tape moves*.
- **Flow hunters** — HELIX; they read institutional prints tick-by-tick, not delayed screenshots.
- **Gamma readers** — Thermal; they think in dealer positioning across the whole surface.
- **Desk operators** — Largo; they want a structure-first answer, not chat.
- **Swing traders** — Night Hawk; they hold overnight and demand a graded thesis with receipts.
- **Universe scanners** — Vector; they hunt setups beyond SPX across many tickers.

These are the *same trader* in different postures through a session — which is why the app must
feel like one desk with six lenses, not six apps. This user is impatient, sophisticated, and
allergic to marketing fluff. They will judge the app in the first ten seconds by whether the
numbers are real, current, and precise. Everything downstream serves that judgment.

They are also a user Apple classifies at **4+**, Finance/Business — the app carries no gambling,
no simulated gambling, no real-money wagering, and a closed navigation allow-list
(`docs/ios/ASC-METADATA.md`). "Serious tool for serious traders" and "App-Store-clean" are the
same design target here, not a tension.

---

## 3. What the app must communicate

Every screen, transition, number, and haptic should reinforce six qualities. These are not
decoration — each maps to something the product already does.

- **Intelligence.** BlackOut does not dump raw data; it *reasons* over it. A single engine —
  BlackOut Intelligence (BIE) — grades SPX plays, answers in Largo, and ranks Vector setups
  (`src/features/largo/answer/BieAnswer.tsx`; `products.ts` "same BIE verification stack",
  "Routes through BlackOut Intelligence on every ask"). The app must feel like it *understands*
  the market, not just displays it.

- **Control.** The trader is in command of the lens, the ticker, the expiry, and the timeframe.
  The desks already expose GEX/VEX/DEX/CHARM lens toggles, DTE scoping, and multi-ticker
  presets (`src/features/vector`, `src/features/thermal`). Native controls — segmented pickers,
  fast toggles, gestural scrubbing — should make switching perspective feel instantaneous and
  precise, never like navigating a menu tree.

- **Speed.** Real-time, tick-by-tick, no 15-minute delays (`docs/ios/ASC-METADATA.md`). The SPX
  matrix refreshes on an ~8s RTH cycle (`products.ts` stat), flow streams live, and Vector's
  wall rail forms and updates continuously. Native rendering exists to make that immediacy
  *felt* — data that arrives should animate in, not stutter or reload.

- **Precision.** Institutional numbers are exact. King strikes, flip levels, expected move,
  entry/target/stop are specific — and the desk's known data-hygiene rule is to round malformed
  floats at the data layer (`CLAUDE.md` data-correctness notes; e.g. never show
  `7499.360000000001`). The app must present numbers cleanly, aligned, and to a sane precision.
  Sloppy formatting reads as untrustworthy data.

- **Institutional credibility.** The voice is "one command surface for the floor" — a desk, a
  terminal, an intelligence layer. The visual language is dark (`#040407` canvas, per
  `apps/blackout-ios/capacitor.config.ts`), restrained, and typographically disciplined, with
  a single per-desk accent (`products.ts` `accent`, e.g. SPX green `#00e676`) rather than a
  rainbow. It should feel closer to a Bloomberg terminal or a pro charting app than to a
  consumer fintech.

- **Risk awareness.** Every read carries its own undoing. SPX plays surface entry, target,
  stop, and an **invalidation** level with an explicit thesis-break rule
  (`src/features/spx/lib/spx-play-thesis.ts`); Largo answers foreground an `invalidation` line
  and an honest "answered X/Y parts" footer plus "source unavailable" chips
  (`src/features/largo/answer/BieAnswer.tsx`); Night Hawk plays can be graded, then *downgraded*
  the next morning to CONFIRMED / DEGRADED / UNVERIFIED / INVALIDATED
  (`src/features/nighthawk/components/PlaybookPlayRow.tsx`). The app must make the *risk* as
  legible as the opportunity. Confidence without invalidation is exactly the failure mode we
  reject.

---

## 4. What the app must NEVER feel like

The fastest way to destroy the credibility above is to feel like any of the following. Each of
these is a real, nameable anti-pattern — and each has a specific trap in *this* codebase.

- **A mobile website.** The transitional shipping vehicle is a Capacitor WKWebView loading prod
  (`apps/blackout-ios/capacitor.config.ts`; `docs/ios/EXECUTION-STATE.md`). That is a bridge,
  not the destination. The native app must not scroll like a webpage, bounce like a webpage,
  render web chrome, or expose a URL bar's worth of latency. Native navigation, native lists,
  native gestures, native transitions — or it has failed its own premise.

- **A wrapper.** Apple's Guideline 4.2 rejects a bare site in a frame, and the current hybrid
  clears the bar only "defensibly but thin" (`docs/ios/NATIVE-VALUE-AND-PRIVACY-AUDIT.md`). The
  native app closes that gap by *being* native: real SwiftUI views over real data contracts,
  with genuine platform capabilities (Face ID, APNs, share, deep links) as first-class
  behaviors rather than advertised-but-unwired config
  (`docs/ios/IOS-PREMIUM-PROGRAM.md` capability table).

- **A Discord companion.** A real community exists (`SITE.social.discord`), but the app is a
  **desk**, not a chat client with charts bolted on. It must never read as an alert-relay for a
  server, a message feed, or a place whose primary content is other people talking. The center
  of gravity is the market and the decision — always.

- **A signal feed.** BlackOut is explicitly *not* "noise for noise's sake" — Night Hawk fires
  "alerts when gates clear," Largo gives "structure, not chat fluff" (`products.ts`). A wall of
  green/red BUY/SELL cards with no thesis, no invalidation, and no track record is the exact
  opposite of the product. Every surfaced call carries its reasoning and its stop, or it does
  not ship. Transparency is a feature: Night Hawk keeps a transparent A–F log; the desk keeps
  an append-only performance record (`/track-record`, `docs/ios/ASC-METADATA.md`).

- **A gambling / crypto-neon app.** No glowing casino aesthetics, no lambo energy, no "🚀 to the
  moon," no confetti on a win, no leaderboards of gamblers. The app rates 4+ with "Simulated
  Gambling: None" and no real-money wagering by deliberate design (`docs/ios/ASC-METADATA.md`).
  Accents are used as *identity and signal*, never as slot-machine dazzle. Options carry
  substantial risk and the product says so; the tone is a trading floor at 4am, not a betting
  app.

The single sentence that captures all five: **it must feel like professional equipment, not
consumer entertainment.**

---

## 5. The core product principle — surface the decision, not every number

BlackOut has access to an enormous amount of data: full options chains, tick-by-tick flow, dealer
gamma across every strike and expiry, minute bars, dark-pool prints, catalysts. The temptation —
and the failure mode of most "pro" trading apps — is to show *all of it*. BlackOut's product
principle is the opposite:

> **Do the reasoning, then surface the decision. Keep every number one tap away — but lead with
> the read.**

This is not aspiration; it is already how the product is built:

- **Largo** does not return a data dump. It returns a `BieAnswerEnvelope` — a headline, a bias,
  a confidence, an invalidation, and (only when merited) expandable sections, evidence, key
  levels, and scenarios. Shallow questions get compact prose; rich ones expand. "Depth matches
  merit" is a literal comment in `src/features/largo/answer/BieAnswer.tsx`.

- **SPX Slayer** distills a live gamma matrix into a single graded play read — direction, entry,
  target, stop, and the invalidation level — with the raw ladder still there beneath it
  (`src/features/spx/components/SpxDashboard.tsx`, `spx-play-thesis.ts`).

- **Vector** turns a wall of positioning data into one plain-English regime line above the
  chart — "long gamma reads calm, short gamma reads volatile, at-flip reads undecided" — and
  hides the banner entirely rather than show a hollow chip when it has nothing to say
  (`src/features/vector/components/VectorRegimeBanner.tsx`).

- **Night Hawk** ranks the night's setups and leads with a conviction grade and a morning-confirm
  status, with the full thesis trail behind a tap (`PlaybookPlayRow.tsx`, `PlayDetailModal`).

The native app must honor this at every altitude. The home surface answers *"what matters right
now?"* A tap answers *"why?"* Another tap answers *"show me the numbers."* Progressive disclosure
is the design contract. On a phone screen, this principle is not a nicety — it is the only way the
product is usable at all. A trader glancing at their phone between other tasks needs the decision
in one glance, the evidence in one tap, and the full chain when — and only when — they ask for it.

---

## 6. The six desks as coordinated intelligence modules — one system, not six tabs

The strategic mistake to avoid is treating the app as six independent products behind six tabs.
The desks are **modules of one intelligence system** that share a data spine (server-side UW +
Polygon feeds, surfaced to the client via SSE/SWR — `CLAUDE.md` environment realities), a single
reasoning engine (BIE), and a common vocabulary of objects: a **ticker**, a **strike**, a
**level**, a **play**, a **regime**. The native app's job is to make those objects *continuous*
across modules — so the trader is never re-orienting, only changing lens.

The wiring already exists in the codebase and should be the model for the native IA:

- **HELIX feeds SPX Slayer confluence and the Night Hawk scanner** (`products.ts` HELIX bullets)
  — flow is an input to structure and to swing selection, not a standalone tape.
- **SPX Slayer embeds the Vector chart** on one shared code path with a shared price axis, so the
  0DTE ladder and the chart land on the same pixel heights
  (`SpxDashboard.tsx` — the `VectorPriceScaleMap` seam and the "one flagship desk, one source of
  truth" consolidation comment).
- **Night Hawk's evening scanner is tied to HELIX anomalies** (`products.ts` Night Hawk bullets).
- **SPX plays, Largo answers, and Vector setups all route through the same BIE verification
  stack** (`products.ts`; `BieAnswer.tsx`), so a grade means the same thing everywhere.

### The six modules (grounded in the real desks)

| Module | Route | Role in the system | Grounding |
|---|---|---|---|
| **SPX Slayer** | `/dashboard` | The anchor. Live 0DTE gamma matrix, dealer walls, king strikes, spot row, and a graded (A–F) play read — the flagship decision surface. | `src/features/spx/*`; `products.ts` id `spx` |
| **HELIX** | `/flows` | The institutional flow tape — tick-by-tick UOA, sweep-vs-block detection, dark-pool context, anomaly scoring. The *input* that other modules consume. | `src/features/helix/components/{FlowFeed,DarkPoolPanel,StrikeStackDetector,...}` |
| **BlackOut Thermal** | `/heatmap` | The macro dealer-gamma view — full-surface GEX/VEX/DEX/CHARM across strikes and expiries. The *context* for where SPX structure sits. | `src/features/thermal/components/GexHeatmap.tsx` |
| **Largo** | `/terminal` | The desk analyst — ask in plain English, get a structure-first read with bias, confidence, key levels, scenarios, and invalidation. The *interpreter* over every other module's data. | `src/features/largo/answer/BieAnswer.tsx` |
| **Night Hawk** | `/nighthawk` | The overnight/swing playbook — evening scanner, ranked graded plays, morning-confirm status, transparent A–F log. The *time-shifted* decision surface. | `src/features/nighthawk/components/{PlaybookBoard,PlaybookPlayRow,PlayDetailModal}` |
| **Vector** | `/vector` | The cross-ticker radar — gamma-wall rail, regime banner, max-pain, flip, expected move, replay. The *universe expansion* beyond SPX, and the charting engine SPX Slayer embeds. | `src/features/vector/*` (the largest feature surface in the repo) |

A note on maturity so the native build is honest with itself: SPX Slayer, HELIX, Thermal, Largo,
and Night Hawk are **live** (`products.ts launchStatus: "live"`). **Vector** is marketed as
"soon" (`launchStatus: "soon"`) yet is in fact the most heavily built feature area and is already
embedded live inside the SPX dashboard — a partial-to-live reality the native IA should treat as a
first-class module, not a coming-soon placeholder.

### What "coordinated" means for the native experience

The native app should let the trader **carry an object across modules without losing context**:

- Tap a strike in HELIX's flow → see it as a wall in Thermal and a level on the SPX ladder.
- See a regime flip in Vector → ask Largo *why* → get the invalidation → check whether Night Hawk
  already has a play on it.
- Read the SPX play → trace its confluence back to the flow prints that support it.

That is the difference between "six tabs" and "one desk." The tab bar is a *lens selector*, not a
set of front doors to unrelated apps. The system's intelligence lives in the connections between
modules, and the native app's highest expression of value is making those connections feel like a
single, coherent instrument.

---

## 7. The north star — what "done" feels like

The native BlackOut iOS app is finished, in vision terms, when:

- A trader opens it and **within one glance** knows the market's posture, the day's best-graded
  read, and where that read breaks — before touching a single control.
- Every number is **real, current, and cleanly precise** — and visibly so.
- Switching lens, ticker, expiry, or timeframe is **instant and tactile**, with haptic and motion
  feedback that a webpage can never fake.
- The app **never once** reads as a website, a wrapper, a chat companion, a signal firehose, or a
  gambling product.
- The six desks feel like **one instrument** — the trader moves through flow → structure →
  interpretation → play → record without ever re-orienting.
- It could sit on the same home screen as Bloomberg, the Apple design-award shelf, and
  TradingView, and **belong there.**

That is the bar. This document is the standard every subsequent iOS decision — architecture,
design system, information architecture, and shipped screen — is measured against.
