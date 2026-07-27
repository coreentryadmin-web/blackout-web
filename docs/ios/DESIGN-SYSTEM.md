# BLACKOUT — Native iOS Design System

**Purpose.** The single source of truth for the **native SwiftUI** BlackOut app (Bloomberg /
Apple / TradingView grade). It extracts the color, type, spacing, motion and component language that
already ships in the web/Capacitor shell and defines the canonical native form. Everything below is
grounded in the real repo; each token cites the file it comes from and is marked **EXISTING** (a
value that already lives in code), **PARTIAL** (present but incomplete), or **PROPOSED** (the native
form we are defining here — the web equivalent exists but must be restated for SwiftUI).

**How to read the status tags**
- **EXISTING** — a literal value in a committed file; copy it verbatim into the SwiftUI theme.
- **PARTIAL** — exists in the shell but not fully wired (e.g. haptics only cover two events).
- **PROPOSED** — the native decision. The web uses web fonts (Inter/Anton/Syne/JetBrains); native
  uses the Apple system faces (SF Pro / SF Mono) plus one bundled branded display face. Those
  mappings are PROPOSED because the source values are web-font names, not SF.

**Primary source files**
- `src/app/ios-native-tokens.css` — spacing + type scale (command center)
- `src/app/ios-native-skin.css` — the unified token block (colors, surfaces, radii, shadows, controls)
- `src/app/ios-native-cards.css` — card semantics (metric/AI/alert/risk/bull/offline)
- `src/app/ios-native-command.css` — command-center atmosphere (void grid, panels)
- `src/app/ios-native-motion.css`, `ios-native-nav.css`, `ios-native-tab-rail.css` — motion
- `src/app/ios-native-iphone16.css` — device tiers + safe-area
- `src/app/globals.css` — root brand tokens (`--color-*`, `--bull/--bear`, brand gradient, design-system scale)
- `src/lib/ios-tool-routes.ts` — per-desk product identity + accent colors (`IOS_TOOLS`)
- `src/components/marks/ProductMark.tsx` — the six product sigils + canonical `MARK_ACCENT`
- `src/lib/ios-haptics.ts` — the wired native haptics bridge
- `src/app/layout.tsx` — web font registration + `themeColor` / status-bar style

---

## 1. Design principles

1. **True black, data-forward.** The canvas is `#040407` (not iOS system black `#000`). Data is the
   wallpaper — charts, ladders, and numerals carry the surface; chrome recedes. This mirrors the
   command-center intent stated verbatim in `ios-native-command.css:2-4` ("Bloomberg Terminal ×
   TradingView × spatial HUD. Sharp, dark, data-dense. NOT generic fintech cards/tabs.").
2. **One accent per context.** A single per-desk accent color drives every active/selected/glow
   state on that screen. Switching desk = switching one variable (`--ios-accent` on web;
   `Theme.accent` in SwiftUI). Never mix two desk accents on one screen.
3. **Color is semantic, never decorative.** Green = system/bullish. Cyan = neutral informational
   market data. Amber = caution/watching. **Red is reserved exclusively for risk, invalidation, and
   loss** — never used for "primary" or "delete-that-isn't-dangerous."
4. **Restraint over neon.** Glows are low-alpha and short-radius. The green is *controlled* — used
   for the primary action and bullish state, not as a background wash.
5. **Every surface reads as one product.** Marketing = desk = native app share the same token
   vocabulary (`layout.tsx:5-9` loads the token foundation once so "marketing = desk = ios all read
   the same instrument grid").
6. **Accessibility is a floor, not a nicety.** WCAG AA on `#040407`, 44pt touch targets, Dynamic
   Type, and `prefers-reduced-motion` honored everywhere (already true across the CSS; must carry
   into SwiftUI).

---

## 2. Color tokens

### 2.1 Foundations — true black + deep charcoal

| Token | Hex / value | Status | Source |
|---|---|---|---|
| `void` (base canvas) | `#040407` | EXISTING | `ios-native-skin.css:14` (`--ios-surface-0`); `globals.css:37,189` (`--color-void`, `body`); `layout.tsx:68` (`themeColor`); splash bg `capacitor.config.ts` |
| `surface1` (panel / glass) | `rgba(10,11,18,0.94)` | EXISTING | `ios-native-skin.css:15` (`--ios-surface-1`) |
| `surface2` (raised tile) | `rgba(255,255,255,0.035)` | EXISTING | `ios-native-skin.css:16` (`--ios-surface-2`) |
| `surface3` (menus/popovers) | `rgba(255,255,255,0.06)` | EXISTING | `ios-native-skin.css:17` (`--ios-surface-3`) |
| `glass` (chrome blur base) | `rgba(8,9,16,0.88)` | EXISTING | `ios-native-skin.css:18` (`--ios-glass`) |
| `command panel` | `rgba(6,7,12,0.96)` | EXISTING | `ios-native-command.css` (`--cmd-panel`) |

For **opaque** SwiftUI fills where translucency isn't available (widgets, launch, opaque cards) use
the canonical opaque charcoal ramp from the global design system:

| Token | Hex | Status | Source |
|---|---|---|---|
| `surfaceOpaque1` | `#0B1017` | EXISTING | `globals.css:112` (`--surface-1`) |
| `surfaceOpaque2` | `#0E141D` | EXISTING | `globals.css:113` (`--surface-2`) |
| `surfaceOpaque3` | `#121A25` | EXISTING | `globals.css:114` (`--surface-3`) |

> **Rule:** translucent surfaces (`surface1/2/3`, `glass`) sit on top of the void with a material
> blur. Opaque surfaces are only for contexts that can't blur. Never lighten the void itself —
> `globals.css:33-37` explicitly notes the page background is hardcoded `#040407`.

### 2.2 Brand green (controlled)

| Token | Hex | RGB | Status | Source |
|---|---|---|---|---|
| `brandGreen` / `bull` | `#00e676` | `0,230,118` | EXISTING | `ios-native-skin.css:8-9`; `globals.css:26,88,94` (`--color-green`, `--bull-text`, `--bull`) |
| `accentGlow` | green @ 35% alpha | — | EXISTING | `ios-native-skin.css:10` (`--ios-accent-glow`) |
| `accentSoft` | green @ 12% alpha | — | EXISTING | `ios-native-skin.css:11` (`--ios-accent-soft`) |
| `accentMuted` | green @ 8% alpha | — | EXISTING | `ios-native-skin.css:12` (`--ios-accent-muted`) |

`#00e676` is both the default global accent and the SPX Slayer desk accent. It clears WCAG AA on the
void (~11:1) as text (`globals.css:82-88`). Use the alpha-derived variants for fills/glows so the
green never becomes a heavy background.

### 2.3 Neutral / type colors (white & readable neutrals)

| Token | Hex | Status | Source | Use |
|---|---|---|---|---|
| `textPrimary` | `#f0f0f8` | EXISTING | `globals.css:190` (`body color`) | Body / default text |
| `textOnColor` | `#ffffff` | EXISTING | `ios-native-skin.css` (many `color:#fff`) | Text on accent fills, active states |
| `textSecondary` | `#b9c7d6` | EXISTING | `globals.css:104` (`--text-secondary`) | Sublabels, descriptions (AA ~9:1, blue-tinted, **not grey**) |
| `textMute` | `#9fb4d4` | EXISTING | `globals.css:103` (referenced `--text-mute`) | Quietest non-trust labels only |
| `textField` | `#f4f6fb` | EXISTING | `globals.css:157` (autofill fill) | Input value text |

> **Never** use pure/low-alpha grey for text — the repo bans it (`globals.css:97-104`): muted copy
> uses the blue-tinted `textSecondary`, not `white/45`.

### 2.4 Cyan — informational market data (neutral)

| Token | Hex | Status | Source | Use |
|---|---|---|---|---|
| `infoCyan` | `#22d3ee` | EXISTING | `globals.css:29` (`--color-cyan`); Largo desk accent | Neutral data readouts, Largo/AI |
| `infoSky` | `#7dd3fc` | EXISTING | `ios-native-skin.css:74,240,334,376` | Utility accents, stat labels, seg-button idle text, scrollbar |
| `focusRing` | `#38bdf8` | EXISTING | `globals.css:184` (`:focus-visible`) | Keyboard/focus outline |
| `infoInk` | `#e0f2fe` | EXISTING | `ios-native-skin.css:404` | Cyan text on cyan-tinted surfaces |

Cyan is the **neutral informational** family: spot/price readouts that aren't themselves
directional, metric labels, secondary chrome, and the Largo (AI analyst) identity. It carries no
bull/bear meaning.

### 2.5 Amber — caution / watching

| Token | Hex | Status | Source | Use |
|---|---|---|---|---|
| `warnAmber` | `#f59e0b` | EXISTING | `globals.css:7745,7914` (`.vp-regime--warn`, `.vp-sig--warn`) | Caution / "watching" regime, warn signals |
| `warnAmberText` | `#fbbf24` | EXISTING | `globals.css:7790` (`.vp-regime--warn` headline) | Amber text (AA-safe on void) |
| `gold` | `#ffd23f` | EXISTING | `globals.css:30` (`--color-gold`) | Highlight / premium accent moments |

Amber = **not yet actionable / conditional / watching**. It is the middle state between neutral
(cyan) and risk (red). Never use amber for a confirmed loss (that's red) or a confirmed win (green).

### 2.6 Red — RISK ONLY (invalidation / loss / bearish)

| Token | Hex | Status | Source | Use |
|---|---|---|---|---|
| `risk` / `bear` | `#ff2d55` | EXISTING | `globals.css:27,95` (`--color-red`, `--bear`); Night Hawk desk accent | Large display bear text, risk glows/borders, invalidation |
| `bearText` (AA-safe) | `#ff5c78` | EXISTING | `globals.css:87` (`--bear-text`) | **Small** bearish numbers (% change, P&L, distances) |

> **Hard rule (from `globals.css:83-88`):** `#ff2d55` measures ~4.0:1 on the void — below the 4.5:1
> AA floor for normal text. Use `#ff2d55` **only** for large display text (score/headline, clears
> the 3:1 large bar) and for glows/borders. All **small** bearish numerals use `#ff5c78`
> (`bearText`, ~5.0:1). Red is never a "primary button" color and never decorates a neutral action.

### 2.7 Per-desk product accents

These are the canonical per-product identity colors. They must match across `IOS_TOOLS`
(`ios-tool-routes.ts:40-102`) and `MARK_ACCENT` (`ProductMark.tsx`). On web they set `--ios-accent`
via `[data-ios-route="…"]` (`ios-native-skin.css:48-76`); in SwiftUI they set `Theme.accent` per
desk root view.

| Desk | Route | Accent | Hex | Meaning | Source |
|---|---|---|---|---|---|
| **SPX Slayer** | `/dashboard` | Emerald | `#00e676` | System / primary — 0DTE structure desk | `ios-tool-routes.ts:47`; `skin:49-52` |
| **HELIX** | `/flows` | Violet | `#bf5fff` | Institutional flow tape | `ios-tool-routes.ts:56`; `skin:53-56`; `--color-purple globals.css:28` |
| **BlackOut Thermal** | `/heatmap` | Orange/ember | `#ff6b2b` | Dealer gamma heat map | `ios-tool-routes.ts:64`; `skin:57-60`; `--color-ember globals.css:31` |
| **Largo** | `/terminal` | Cyan | `#22d3ee` | AI desk analyst | `ios-tool-routes.ts:72`; `skin:61-64` |
| **Night Hawk** | `/nighthawk` | Red | `#ff2d55` | Overnight playbook — "the hunt" | `ios-tool-routes.ts:80`; `skin:65-68` |
| **Vector** | `/vector` | Teal | `#2dd4bf` | Live chart + GEX level overlay | `ios-tool-routes.ts:100`; `ProductMark.tsx MARK_ACCENT` |
| **Utility** | `/account /faq /learn /upgrade /admin` | Sky | `#7dd3fc` | Non-desk chrome | `ios-tool-routes.ts:92-96`; `skin:69-76` |

> Night Hawk's accent is red **because its identity is the hunt**, and that is the one sanctioned
> non-risk use of the red family — but even there, invalidation/loss states inside Night Hawk must
> still read as risk (the accent and the semantic risk color coincide, which is intentional). On
> every other desk, red never appears except as a risk signal.

### 2.8 Signature gradients

| Token | Value | Status | Source |
|---|---|---|---|
| `gradBrand` | `linear-gradient(90deg, #00e676, #34d399 55%, #7dd3fc)` (emerald → mint → sky) | EXISTING | `globals.css:39` (`--grad-brand`) |
| `gradSpectrum` | `#00e676 → #bf5fff → #22d3ee` (scrollbar/spectrum) | EXISTING | `globals.css:206` |

Use `gradBrand` **only** for branded moments (wordmark fills, hero kickers, upgrade CTA). Never for
data or body text.

### 2.9 Borders & hairlines

| Token | Value | Status | Source |
|---|---|---|---|
| `border` | `rgba(255,255,255,0.08)` | EXISTING | `ios-native-skin.css:20` (`--ios-border`) |
| `borderStrong` | `rgba(255,255,255,0.14)` | EXISTING | `ios-native-skin.css:21` (`--ios-border-strong`) |
| `borderAccent` | accent @35% mixed w/ `rgba(255,255,255,0.08)` | EXISTING | `ios-native-skin.css:22` (`--ios-border-accent`) |

---

## 3. Typography

**Web reality (source):** the site loads **Anton** (display, 400), **Syne** (600/700/800),
**JetBrains Mono** (400–700), and **Inter** (body) via `next/font` (`layout.tsx:2,23-44`;
`globals.css:210-259`). Numbers/tickers/kickers are JetBrains Mono; headings are Anton/Syne; body is
Inter.

**Native decision (PROPOSED — the SwiftUI type system):**

| Role | Native face | Maps from (web) | Status |
|---|---|---|---|
| Headings / section titles | **SF Pro Display** (`.system(design: .default)` at title sizes) | Syne / Anton headings | PROPOSED |
| Body / labels / controls | **SF Pro Text** (`.system(design: .default)` at text sizes) | Inter | PROPOSED |
| **Prices, strikes, timestamps, %s, tickers, GEX values** | **SF Mono** (`.system(design: .monospaced)`) with `.monospacedDigit()` | JetBrains Mono | PROPOSED |
| **Product titles / branded moments ONLY** | **Bundled branded display face** (the condensed heavy face — Anton, or its licensed brand equivalent, shipped in the app bundle) | Anton (`.font-display`) | PROPOSED |

> **Branded display font rule (strict).** The branded display face is used **only** for product
> wordmarks (e.g. the "SPX SLAYER" title, "HELIX", upgrade hero) and deliberate branded moments.
> It is **never** used for body copy, controls, buttons, table content, chart axis/labels, or any
> numeric readout. All data and chrome use SF Pro / SF Mono. This preserves legibility at data
> density and keeps the brand voice reserved for identity.

> **SF Mono is mandatory for every number a trader reads** — prices, strikes, expiries,
> timestamps, percentages, greeks, GEX magnitudes. Always `.monospacedDigit()` so digits don't
> jitter as live values tick. This mirrors `globals.css` where nearly every numeric class is
> `var(--font-jetbrains)` and `.t-num` sets `font-variant-numeric: tabular-nums` (`globals.css:256-259`).

### 3.1 Type scale (EXISTING token values → native points)

From `ios-native-tokens.css:13-16` and `ios-native-skin.css:37-42`. Web px == iOS pt at base zoom.

| Token | Value | Status | Native default | Dynamic Type style |
|---|---|---|---|---|
| `typeLabel` | 10px | EXISTING | 10pt | `.caption2` |
| `typeSection` | 11px | EXISTING | 11pt | `.caption` |
| `typeTitle` | 13px | EXISTING | 13pt | `.footnote` / `.subheadline` |
| `typeBody` | 15px | EXISTING | 15pt | `.subheadline` / `.body` |
| `typeInput` | **16px floor** | EXISTING | **16pt (hard floor)** | `.body` |
| `typeTitleLg` | 15px | EXISTING (`--ios-title`) | 15pt | `.headline` |
| Hero price | 2.5rem (Pro) / 2.85rem (Pro Max) | EXISTING | 40pt / 45.6pt | `.largeTitle`, SF Mono |
| Tab label | 8px idle → 9px active | EXISTING | 8pt → 9pt | fixed (chrome) |
| Metric label | 9px | EXISTING | 9pt | `.caption2` |
| Flow badge | 8px | EXISTING | 8pt | fixed |
| Kicker floor | 10px (never smaller) | EXISTING | 10pt | `.caption2`, tracked |

> **16pt input floor is load-bearing** (`ios-native-skin.css:39`): the web comment notes anything
> below 16px triggers WKWebView auto-zoom on focus. In native SwiftUI the WebView constraint is
> gone, but keep 16pt as the input minimum for one-hand legibility.

### 3.2 Letter-spacing (tracking)

| Context | Tracking | Status | Source |
|---|---|---|---|
| Panel/section titles (uppercase) | `0.14em` | EXISTING | `ios-native-skin.css:183,334` |
| Kicker (uppercase mono) | `0.35em` | EXISTING | `globals.css:251` (`.t-kicker`) |
| Segmented buttons | `0.06–0.08em` | EXISTING | `ios-native-skin.css:238,274` |
| Metric labels | `0.14em` | EXISTING | `ios-native-skin.css:334` |

Uppercase mono labels are tracked wide; body/data are not tracked. In SwiftUI use `.tracking()` and
`.textCase(.uppercase)` on labels only.

### 3.3 Dynamic Type

**PROPOSED (required).** All text roles above map to a `Font.TextStyle` and must use
`.font(.system(.<style>))` (or a scaled custom font via `UIFontMetrics`) so the app respects the
system text-size setting. Two hard rules:
1. **Chrome** (tab labels, badges, kickers) may be fixed-size but must not clip — use
   `minimumScaleFactor` and `lineLimit` guards.
2. **Data tables/ladders** scale with Dynamic Type but keep `.monospacedDigit()` and column
   alignment; test at the largest accessibility sizes so GEX ladders and the SPX matrix don't break
   layout.

---

## 4. Spacing scale

From `ios-native-tokens.css:8-19` and `ios-native-skin.css:45`. Base 1rem = 16pt.

| Token | rem | Native | Status |
|---|---|---|---|
| `space1` | 0.25rem | 4pt | EXISTING |
| `space2` | 0.5rem | 8pt | EXISTING |
| `space3` | 0.75rem | 12pt | EXISTING |
| `space4` | 1rem | 16pt | EXISTING |
| `space5` | 1.25rem | 20pt | EXISTING |
| `contentGap` (between modules) | 0.75rem | 12pt | EXISTING (`--ios-content-gap`) |
| `sectionGap` (between sections) | 1rem | 16pt | EXISTING (`--ios-section-gap`) |
| Content padding X (Pro) | 0.75rem | 12pt | EXISTING (`iphone16.css:15`) |
| Content padding X (Pro Max) | 0.85rem | 13.6pt | EXISTING (`iphone16.css:76`) |

**Spacing rules:** 12pt is the default gap between cards; 16pt between distinct sections; 4/8pt for
intra-component padding. Screen gutters are 12–14pt (device-tiered), plus safe-area insets (§6.5).

---

## 5. Radii, borders, elevation, materials

### 5.1 Corner radii (EXISTING — `ios-native-skin.css:24-27`)

| Token | Value | Native | Use |
|---|---|---|---|
| `radiusSm` | 10px | 10pt | Chips, buttons, small tiles, seg items |
| `radiusMd` | 14px | 14pt | Inputs, panels, segmented groups, message bubbles |
| `radiusLg` | 18px | 18pt | **Cards (default card radius)** |
| `radiusXl` | 22px | 22pt | Locked/upgrade screens, **sheet top corners** |
| Pill | 999px | `.capacity`/`Capsule()` | Badges, live chips, tool chips, scrollbar |
| Command panel | 4px / 6px | 4pt / 6pt | Dense terminal panels only (`ios-native-command.css` `--cmd-radius`) |

Card radius = `radiusLg` (18pt) (`--ios-card-radius`, `skin:43`). Panel radius = `radiusMd` (14pt)
(`--ios-panel-radius`, `skin:44`). Bottom sheets use `radiusXl` on the top two corners only
(`skin:546-550`).

### 5.2 Shadows / elevation (EXISTING — `ios-native-skin.css:29-34`)

| Token | Value | Use |
|---|---|---|
| `shadowSm` | `0 4px 16px rgba(0,0,0,0.35)` | Rows, chips, small cards |
| `shadowMd` | `0 8px 32px rgba(0,0,0,0.48)` | Cards, header, menu |
| `shadowLg` | `0 16px 48px rgba(0,0,0,0.55)` | Modals, tab bar, locked screen |
| `shadowInset` | `inset 0 1px 0 rgba(255,255,255,0.06)` | Top-edge highlight on tiles/inputs |
| `shadowCard` | `shadowMd + shadowInset` | The default card elevation |
| `shadowGlow` | `0 0 40px accentGlow` | Signature/hero card halo |

Global halos (from `globals.css:129-131`) for signal emphasis: `glowBull`
`0 0 42px -6px rgba(0,230,118,0.75)`, `glowCyan` `…rgba(34,211,238,0.7)`, `glowViolet`
`…rgba(191,95,255,0.7)`.

> SwiftUI note: compose `shadowCard` as **two** `.shadow()` modifiers (or a background with an inner
> highlight stroke), since SwiftUI shadows don't stack in one call. The inset highlight is best done
> as a 1pt top `LinearGradient` stroke.

### 5.3 Materials / blur

| Surface | Material | Status | Source |
|---|---|---|---|
| Cards / glass panels | `blur(20px) saturate(1.25)` → `.ultraThinMaterial` tuned dark | EXISTING | `ios-native-skin.css:160-161` |
| Tab bar | `blur(24px) saturate(1.3)` over `rgba(4,4,7,0.98)` → `.regularMaterial` dark | EXISTING | `ios-native-tab-rail.css:6-9` |
| Header / menu | `glass` (`rgba(8,9,16,0.88)`) + `shadowMd` | EXISTING | `ios-native-skin.css:115-136` |
| Offline/stale | `blur(12px)` + 0.88 opacity, muted | EXISTING | `ios-native-cards.css:69-78` |

**Atmosphere (EXISTING, optional in native):** a faint 24px void grid with a radial mask
(`ios-native-command.css` `::before`) and an ambient route-tinted radial glow
(`.ios-native-ambient`, `skin:79-100`). In SwiftUI, render the ambient glow as a `RadialGradient`
background tinted with `Theme.accent` at ~16% at top-center; the grid is optional and should be
subtle (≤3.5% alpha) and disabled under reduced-transparency.

### 5.4 Touch targets

`--ios-touch = 2.75rem = 44pt` (`ios-native-skin.css:36`). **Every** interactive element is ≥44×44pt
(buttons, inputs, seg items, send button, menu rows). This is a hard minimum in SwiftUI too.

---

## 6. Components

All controls share a base interaction: `radiusSm` corners, a 0.2s transition, and a **press scale
of 0.96** (`ios-native-skin.css:207-213`; tab links 0.97 in `motion.css:74-77`). In SwiftUI use a
custom `ButtonStyle` applying `scaleEffect(configuration.isPressed ? 0.96 : 1)` with the standard
spring (§7).

### 6.1 Buttons — hierarchy

| Level | Look | Status | Source |
|---|---|---|---|
| **Primary** | Filled brand green; text `#fff`; halo `0 0 24px green@25%`; ≥44pt | EXISTING | `ios-native-skin.css:216-221` (`.bg-bull`) |
| **Secondary** | `surface2` fill, `border` hairline, text `textPrimary`; active → `accentSoft` fill + accent border + `0 0 16px accentGlow` | EXISTING | `skin:265-285` (chips/toggles) |
| **Tertiary / ghost** | Transparent, hairline or borderless; idle text `infoSky`; `blur(8px)` on outline links | EXISTING | `skin:239-242,287-294` |
| **Destructive** | Red (`#ff2d55`) fill or border + red glow `0 0 20px red@12%`; **only** for genuinely destructive/risk actions | EXISTING (pattern) | `ios-native-cards.css:48-55` (risk glow) |
| **Icon button** | 44×44pt hit area, icon-only, ghost background; active state tints with accent | EXISTING | send button `skin:388-394`; tab icons |

> Destructive ≠ secondary. Per §2.6 red is risk-only; a non-dangerous "cancel/close" is a
> tertiary/ghost button, not destructive.

### 6.2 Segmented controls & tabs

- **Group container:** `surface2` fill, hairline border, `radiusMd`, 4pt padding, inset shadow
  (`skin:224-231`).
- **Item:** ≥44pt, `radiusSm`, weight 700, tracked; idle text `infoSky`; active text `#fff`.
- **Selection indicator:** a **sliding pill** — accent @14–18% fill + accent glow + inset top
  highlight — animated with a layout transition (`nav.css:24-34,77-87`; `tab-rail.css:75-102`). In
  SwiftUI: `matchedGeometryEffect` on a `Capsule`/`RoundedRectangle(14)` behind the selected item.
- **Bottom tab bar (instrument rail):** 5 desks (`IOS_TOOL_ROUTES`). Inactive tabs recede to
  **0.42 opacity** (icon 0.55, label `#5a7a9a` @8pt); active tab lifts (`translateY(-3px)`), icon
  scales 1.08 with an accent drop-shadow, label `#fff` @9pt weight 800, plus a moving underline and
  a glowing pill that **pulses** (2.8s) (`tab-rail.css:17-102`). SwiftUI: a custom tab bar (not the
  system `TabView` chrome) over `.regularMaterial`, honoring reduced-motion (disable the pulse).

### 6.3 Cards & panels

Base card (`skin:144-162`): `surface1` fill, hairline border, `shadowCard`, blur+saturate material,
`radiusLg`. Signature card adds accent border + `shadowGlow` (`skin:164-167`). Panels also carry a
**2pt left accent rail** in the desk accent (`ios-native-cards.css:80-86`).

Semantic card variants (`ios-native-cards.css`):

| Variant | Treatment | Status | Source |
|---|---|---|---|
| **Metric tile** | Flat: `rgba(255,255,255,0.02)` fill, 1px `white@5%` border, **no shadow**, `radiusSm` | EXISTING | `cards.css:6-13` |
| **AI / analyst** | Subtle cyan→void→violet gradient wash, cyan-tinted border | EXISTING | `cards.css:15-26` |
| **Alert (active)** | Animated accent ring: inset ring pulses green over 2.4s | EXISTING | `cards.css:28-46` |
| **Risk / bearish** | Red inset ring + `0 0 20px red@12%` glow | EXISTING | `cards.css:48-55` |
| **Bullish** | 2px emerald left rail + emerald inset ring + soft glow | EXISTING | `cards.css:57-66` |
| **Offline / stale** | Muted glass, 0.88 opacity, `blur(12px)`, dim border | EXISTING | `cards.css:68-78` |

### 6.4 Inputs

`skin:296-317`: ≥44pt, `radiusMd`, hairline border, `surface2` fill, text `#fff`, **16pt font
floor**, inset shadow. Focus: accent border + `0 0 0 3px accentMuted` ring. SwiftUI: a styled
`TextField`/`TextEditor` with a focus-driven accent stroke; keep the 16pt floor.

### 6.5 Sheets, menus, modals

- **Bottom sheet / drawer:** `radiusXl` top corners only (`skin:546-550`); dark glass; grabber at
  top; `shadowLg`. SwiftUI: `.presentationDetents`, `.presentationDragIndicator(.visible)`,
  `.presentationBackground(.ultraThinMaterial)` tuned dark.
- **Command deck menu** (`IosNativeMenu`): gradient `rgba(12,13,22,0.98) → void`, strong border;
  instrument rows ≥44pt with accent-tinted hover/press (`skin:133-136`; `command.css`). Selection
  fires a haptic (§8).
- **Modal:** `surface1` fill, `borderStrong`, `shadowLg` (`skin:421-425`).
- **Safe area:** honor `env(safe-area-inset-*)` everywhere; Dynamic Island tier adds top offset
  `calc(2.875rem + max(inset-top, 47px))` (`iphone16.css:139-145`). SwiftUI gets this free via
  `safeAreaInsets`, but the header/tab-bar backgrounds must extend **under** the insets while
  content respects them.

### 6.6 Status, badges & live indicators

- **Badges / live chips:** `Capsule`, small tracked mono (`skin:347-352,538-543`); flow badges 8pt.
- **Freshness states:** driven by a `data-freshness` attribute (`live` / `stale` / `offline`) →
  neutral / muted-amber-ish / dim (`cards.css:70-78`). In SwiftUI model this as a `Freshness` enum
  → color: `live` = accent/cyan, `stale` = `warnAmber`, `offline` = `textMute` + reduced opacity.
- **Directional signal chips:** bull `#00e676`, bear `#ff2d55` (small text → `#ff5c78`), warn
  `#f59e0b` (`globals.css:7912-7926`).

### 6.7 Empty / loading / error / toast states

| State | Treatment | Status | Source |
|---|---|---|---|
| **Loading (skeleton)** | `radiusMd` blocks, gentle pulse (`animate-pulse`), reduced-motion disables it | EXISTING | `skin:567-572` |
| **Empty** | Muted glass card, centered kicker + `textSecondary` copy + a primary CTA; use the offline/stale muted treatment when data is simply absent | EXISTING (pattern) | `cards.css:68-78` |
| **Error** | Card with risk-red hairline/ring + retry (tertiary) button; copy in `textPrimary`, cause in `textSecondary`. **Reserve red for the error accent, not the whole card fill.** | PROPOSED (compose from risk variant `cards.css:48-55`) |
| **Toast** | Dark glass capsule/rounded card, `shadowMd`, accent left rail per severity (green/cyan/amber/red), auto-dismiss; slide-up + fade (§7) | PROPOSED |
| **Desk closed / off-hours** | `spx-desk-closed` muted glass (`cards.css:69`) | EXISTING |

### 6.8 Scrollbars & scroll

WebKit scrollbars are 4px with a `infoSky@35%` thumb (`skin:552-565`). Native uses system scroll
indicators; enable momentum/bounce (the web sets `-webkit-overflow-scrolling: touch`,
`skin:338-340`). Wide content (GEX ladder, SPX matrix, flow tape) scrolls **inside its own**
horizontal scroll container — the screen never scrolls horizontally.

---

## 7. Motion

Two canonical springs and one duration (EXISTING):

| Token | Value | Status | Source |
|---|---|---|---|
| `springContent` | `cubic-bezier(0.16, 1, 0.3, 1)` | EXISTING | `motion.css:7` (`--ios-motion-spring`) |
| `springNav` | `cubic-bezier(0.22, 1, 0.36, 1)` | EXISTING | `nav.css:6` (`--ios-nav-spring`); `skin:200` |
| `durationBase` | 0.22s | EXISTING | `motion.css:8` (`--ios-motion-duration`) |

Global VITALS motion vocabulary (EXISTING — `globals.css:61-70`) for reference/reuse:
`easeSnap (.34,1.56,.64,1)`, `easeDraw (.22,1,.36,1)`, `easeBreath (.4,0,.6,1)`,
`easeSweep (.65,0,.35,1)`; tempo `durFast 120ms / durBase 200ms / durSlow 320ms / durAmbient 6s`.

**Signature animations (EXISTING):**
- **Content rise** — new content fades up 6–8px over 0.22–0.26s (`motion.css:17-56`). SwiftUI:
  `.transition(.opacity.combined(with: .move/offset))` on appear with `springContent`.
- **Staggered module entrance** — 0.02/0.04/0.06s delays across a triple (`motion.css:58-66`).
- **Panel crossfade** — segment switches fade up 10px over 0.32s (`nav.css:100-113`).
- **Tab indicator** — sliding spring pill (`springNav`) with a 2.8s glow pulse (`tab-rail.css:120-136`).
- **Hero price tick** — text-shadow breathes 2.8s on the live price (`motion.css:93-105`).
- **Ambient scan** — 12s opacity pulse on the route glow (`motion.css:79-91`).

**SwiftUI spring mapping (PROPOSED):** approximate `springContent` with
`.spring(response: 0.35, dampingFraction: 0.85)` and `springNav` for navigation/tab transitions.
Interactive press = `.spring(response: 0.25, dampingFraction: 0.7)`.

**Reduced motion (EXISTING, mandatory):** every animation block has a
`@media (prefers-reduced-motion: reduce)` fallback that removes transforms/animations
(`motion.css:124-147`, `nav.css:115-123`, `tab-rail.css:138-146`, `skin:574-580`, `cards.css:88-94`).
In SwiftUI gate all non-essential motion behind
`@Environment(\.accessibilityReduceMotion)` and drop to a plain fade/none.

---

## 8. Haptics

**Wired bridge (EXISTING/PARTIAL — `src/lib/ios-haptics.ts`):** the Capacitor Haptics plugin is the
one fully-wired native API (`NATIVE-VALUE-AND-PRIVACY-AUDIT.md`). Two functions exist today:

| Function | Trigger (web) | Native equivalent | Status |
|---|---|---|---|
| `iosHapticSelection()` — selectionStart → changed → end | Tab switches, chip selects (`IosAppTabBar.tsx:73`, `IosNativeMenu.tsx:37,99`) | `UISelectionFeedbackGenerator.selectionChanged()` | EXISTING |
| `iosHapticImpact("Light"\|"Medium"\|"Heavy")` | Sheet open, primary actions | `UIImpactFeedbackGenerator(style: .light/.medium/.heavy)` | PARTIAL (only two call sites today) |

**Native haptics map (PROPOSED — expand coverage):**

| Event | Generator | Style |
|---|---|---|
| Tab / segment / chip change | `UISelectionFeedbackGenerator` | selection |
| Sheet / menu open, primary CTA | `UIImpactFeedbackGenerator` | `.medium` |
| Toggle on/off, minor tap | `UIImpactFeedbackGenerator` | `.light` |
| **New trade alert / signal fires** | `UINotificationFeedbackGenerator` | `.success` (bull) / `.warning` (watch) |
| **Invalidation / stop hit / loss** | `UINotificationFeedbackGenerator` | `.error` |
| Pull-to-refresh commit, drag snap | `UIImpactFeedbackGenerator` | `.heavy` / `.rigid` |

> Prepare generators before use (`.prepare()`) to remove latency, and respect the system haptics
> setting. Haptics reinforce semantics: success feel for bull/confirm, error feel for risk — never
> fire an error haptic for a neutral action.

---

## 9. Chart & data-viz styling

Charts are the product; they get first-class treatment. Grounded in the desk color language and the
Vector/SPX chart surfaces.

- **Canvas background:** `void` (`#040407`) — charts sit directly on the canvas, no card chrome
  around the plot area.
- **Grid lines:** ≤4% white or `infoSky@3%` (matches the void grid, `command.css`); axis ticks
  quiet.
- **Axis / labels:** **SF Mono**, `textSecondary`/`textMute`, small (10–11pt). **Never** the
  branded display font on chart labels (§3).
- **Price / numerals:** SF Mono, `.monospacedDigit()`.
- **Directional series:** bullish `#00e676`, bearish `#ff2d55` (fills at low alpha; strokes at full)
  — see `globals.css` regime tokens `.vp-regime--bull #22c55e/#4ade80`, `--bear #ef4444/#f87171`,
  `--warn #f59e0b/#fbbf24` for the softer chart-fill variants (`globals.css:7743-7790`).
- **Neutral overlays (VWAP, spot, levels):** `infoCyan`/`infoSky` — informational, non-directional.
- **Watch/threshold zones:** `warnAmber`.
- **GEX ladder / heat:** per-desk accent for magnitude; Thermal uses its ember→heat mapping;
  descending, one "king" per side, spot band highlighted (per the Vector HARDCORE contract in
  `CLAUDE.md`).
- **Live tick emphasis:** subtle glow breath on the current price only (from the hero-tick pattern),
  reduced-motion safe.
- **Regime banner:** bull/bear/warn wording and color must match spot-vs-flip (green/red/amber);
  color is redundant with an icon/word so it's not color-only (accessibility).

---

## 10. SwiftUI theme scaffold (PROPOSED)

The governing shape of the theme. Values are the EXISTING tokens above; the code is the native
form to implement.

```swift
enum Theme {
    // Foundations
    static let void      = Color(hex: 0x040407)          // ios-native-skin.css:14
    static let surface1  = Color(white: 1, opacity: 0)   // rgba(10,11,18,0.94) — use exact RGBA
    static let surface2  = Color.white.opacity(0.035)    // ios-native-skin.css:16
    static let surface3  = Color.white.opacity(0.06)
    static let glass     = Color(hex: 0x080910, opacity: 0.88)
    static let surfaceOpaque1 = Color(hex: 0x0B1017)     // globals.css:112

    // Brand + semantic
    static let brandGreen = Color(hex: 0x00E676)         // bull / primary
    static let risk       = Color(hex: 0xFF2D55)         // red — RISK ONLY
    static let riskText   = Color(hex: 0xFF5C78)         // small bear numbers (AA)
    static let infoCyan   = Color(hex: 0x22D3EE)         // neutral market data
    static let infoSky    = Color(hex: 0x7DD3FC)
    static let warnAmber  = Color(hex: 0xF59E0B)         // caution / watching
    static let gold       = Color(hex: 0xFFD23F)

    // Text
    static let textPrimary   = Color(hex: 0xF0F0F8)
    static let textSecondary = Color(hex: 0xB9C7D6)
    static let textMute      = Color(hex: 0x9FB4D4)

    // Borders
    static let border       = Color.white.opacity(0.08)
    static let borderStrong = Color.white.opacity(0.14)

    // Radii (pt)
    enum Radius { static let sm = 10.0, md = 14.0, lg = 18.0, xl = 22.0 }
    // Spacing (pt)
    enum Space  { static let s1 = 4.0, s2 = 8.0, s3 = 12.0, s4 = 16.0, s5 = 20.0 }
    static let touch = 44.0

    // Per-desk accent (drive with the active route)
    static func accent(for desk: Desk) -> Color {
        switch desk {
        case .spx:       return Color(hex: 0x00E676)  // SPX Slayer
        case .helix:     return Color(hex: 0xBF5FFF)  // HELIX
        case .thermal:   return Color(hex: 0xFF6B2B)  // Thermal
        case .largo:     return Color(hex: 0x22D3EE)  // Largo
        case .nighthawk: return Color(hex: 0xFF2D55)  // Night Hawk
        case .vector:    return Color(hex: 0x2DD4BF)  // Vector
        case .utility:   return Color(hex: 0x7DD3FC)  // account/faq/learn/upgrade/admin
        }
    }

    // Motion
    static let springContent = Animation.spring(response: 0.35, dampingFraction: 0.85)
    static let springNav     = Animation.spring(response: 0.32, dampingFraction: 0.82)
    static let springPress   = Animation.spring(response: 0.25, dampingFraction: 0.70)
}
```

Fonts (PROPOSED):

```swift
enum BOFont {
    static func heading(_ style: Font.TextStyle = .title2) -> Font { .system(style, design: .default).weight(.bold) }
    static func body(_ style: Font.TextStyle = .body)       -> Font { .system(style, design: .default) }
    static func mono(_ style: Font.TextStyle = .subheadline)-> Font { .system(style, design: .monospaced).monospacedDigit() }
    // Branded display — bundled condensed heavy face; PRODUCT TITLES / BRANDED MOMENTS ONLY.
    static func display(size: CGFloat) -> Font { .custom("Anton-Regular", size: size) } // or licensed brand equivalent
}
```

---

## 11. Cross-cutting rules (checklist for every screen)

- [ ] Canvas is `#040407`; no lighter page background.
- [ ] Exactly one desk accent drives all active/selected/glow states on the screen.
- [ ] Red appears **only** for risk/invalidation/loss (Night Hawk accent is the sole exception, §2.7).
- [ ] Cyan = neutral data; amber = watching/caution; green = system/bullish.
- [ ] All numbers a trader reads are SF Mono + `.monospacedDigit()`.
- [ ] Branded display font used only on product titles/branded moments — never data, controls, or chart labels.
- [ ] Dynamic Type respected; data tables tested at largest accessibility sizes.
- [ ] Every interactive element ≥44×44pt.
- [ ] Safe-area insets honored; chrome extends under insets, content respects them.
- [ ] Small bearish numerals use `#ff5c78`, not `#ff2d55` (AA).
- [ ] Wide data scrolls inside its own container; the screen never scrolls horizontally.
- [ ] All motion has a reduced-motion fallback; haptics respect the system setting.
- [ ] Loading (skeleton), empty, error, and offline/stale states are all designed — not just the happy path.

---

## 12. Provenance & open decisions

**Fully grounded (EXISTING) —** colors, surfaces, radii, shadows, spacing, type scale, motion
springs, per-desk accents, haptics bridge, materials, safe-area handling. All cite a file:line
above.

**Native decisions (PROPOSED) —** SF Pro / SF Mono / bundled branded display mapping (web uses
Inter/Anton/Syne/JetBrains); Dynamic Type; the SwiftUI `Theme`/`BOFont` scaffold; expanded haptic
map; toast/error state composition. These restate an existing web value in native form.

**Open / to confirm with owner —**
- The bundled branded display face: ship **Anton** (current web display face, `layout.tsx:23-28`)
  or a licensed brand-owned condensed heavy face? Design system assumes Anton until told otherwise.
- Whether the void-grid atmosphere (§5.3) carries into native or is dropped for a cleaner canvas —
  recommend keeping it very subtle and off under reduced-transparency.
- Light mode: the app is **dark-only** today (true-black command center). No light theme is defined;
  confirm dark-only ships (recommended) before investing in a light palette.

*This document governs the SwiftUI theme. Keep it in sync with `ios-native-skin.css` /
`ios-tool-routes.ts` / `ProductMark.tsx` — if a token changes there, change it here.*
