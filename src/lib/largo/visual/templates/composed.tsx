/**
 * COMPOSED — the card with no fixed layout.
 *
 * Every other template in this directory is a designed arrangement for one kind of question. This
 * one is a renderer for whatever `composeCard` selected: it draws the chosen blocks, in the order
 * it was given, and has no opinion about which blocks those are. That is what makes a "how does
 * TSLA look today" card different from a "what did the firewall hold" card without either being a
 * template — same code, different evidence, different question, different result.
 *
 * IT DRAWS THE SAME PRIMITIVES THE DESIGNED TEMPLATES DO. Nothing here is a second implementation
 * of a level map or a flow tape; each case delegates to the shared primitive or to the designed
 * template's own section. So a fix to `LevelMap` reaches every card, composed or not, and a
 * composed card cannot drift into a different visual language from the rest of the library.
 *
 * TRUNCATION IS RENDERED. `composeCard` reports blocks it had room for but not space to draw, and
 * the footnote names them. A composed card is the surface where silent dropping would be least
 * detectable — there is no expected layout to notice a hole in — so it is the surface where saying
 * so matters most.
 *
 * WHY NOT LET A MODEL DRAW IT. The obvious "fully dynamic" design is to have Largo emit layout and
 * content together. That was rejected for the same reason `bundle.ts` makes no market-data calls:
 * a number that reaches the canvas through prose can differ from the number in the answer, and on
 * a shareable asset that contradiction is permanent and uncheckable. Largo chooses WHICH blocks
 * (see `emphasis` in compose.ts); the blocks read their values from the bundle. Selection is soft,
 * values are hard.
 */

import type { ReactElement } from "react";
import { C, FONT } from "../tokens";
import type { SizeSpec } from "../sizes";
import { s } from "../sizes";
import type { ManifestRecorder } from "../manifest";
import type { VisualBundle } from "../types";
import type { Composition } from "../compose";
import {
  CardFooter,
  CardHeader,
  CardShell,
  GexBars,
  Headline,
  HeroNumber,
  Kicker,
  LevelMap,
  MetricRow,
  PnlBlock,
  SystemStrip,
  Timeline,
} from "../primitives";

/** Section wrapper: a label above a block, with the block's own spacing. */
function Section({
  label,
  spec,
  children,
  first,
}: {
  label: string | null;
  spec: SizeSpec;
  children: ReactElement;
  first: boolean;
}): ReactElement {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        width: "100%",
        marginTop: first ? 0 : s(spec.dense ? 14 : 20, spec),
      }}
    >
      {label && <Kicker text={label} spec={spec} />}
      <div style={{ display: "flex", width: "100%", marginTop: label ? s(9, spec) : 0 }}>{children}</div>
    </div>
  );
}

/** A compact labelled row of value chips — used by blocks whose data is a handful of scalars. */
function ChipRow({
  items,
  spec,
}: {
  items: { label: string; value: string; color: string }[];
  spec: SizeSpec;
}): ReactElement {
  return (
    <div style={{ display: "flex", width: "100%" }}>
      {items.map((it, i) => (
        <div
          key={it.label}
          style={{
            display: "flex",
            flexDirection: "column",
            flex: 1,
            marginLeft: i === 0 ? 0 : s(12, spec),
            padding: s(11, spec),
            background: "rgba(255,255,255,0.02)",
            borderTop: `${s(2, spec)}px solid ${it.color}`,
          }}
        >
          <Kicker text={it.label} spec={spec} />
          <div
            style={{
              display: "flex",
              fontFamily: FONT.mono,
              fontWeight: 700,
              fontSize: s(26, spec),
              color: it.color,
              marginTop: s(5, spec),
            }}
          >
            {it.value}
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Ranked rows, with an OPTIONAL magnitude bar.
 *
 * `magnitude: null` draws no bar, and that is not a styling choice. The flow block carries
 * `premiumDisplay` as a pre-formatted string ("$8.2M") and no numeric premium, so there is nothing
 * to scale a bar against. The first version passed a constant, which drew three identical bars
 * beside $8.2M, $4.1M and $2.9M — a chart asserting the prints were equal in the one dimension a
 * bar exists to compare. A missing bar says nothing; an equal bar says something false.
 */
function RankedRows({
  rows,
  spec,
  max,
}: {
  rows: { label: string; sub?: string | null; value: string; magnitude: number | null; color: string }[];
  spec: SizeSpec;
  max: number;
}): ReactElement {
  const shown = rows.slice(0, max);
  // Scaled on ABSOLUTE magnitude so a −50% loser reads as visually heavy as a +50% winner. Scaling
  // on the signed value would make losses look smaller than they are, which is the one direction
  // a performance graphic must never distort.
  const peak = Math.max(...shown.map((r) => Math.abs(r.magnitude ?? 0)), 1);
  return (
    <div style={{ display: "flex", flexDirection: "column", width: "100%" }}>
      {shown.map((r, i) => (
        <div
          key={`${r.label}-${i}`}
          style={{
            display: "flex",
            alignItems: "center",
            width: "100%",
            padding: `${s(8, spec)}px ${s(12, spec)}px`,
            marginTop: i === 0 ? 0 : s(5, spec),
            background: "rgba(255,255,255,0.015)",
            borderLeft: `${s(3, spec)}px solid ${r.color}`,
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", width: s(200, spec), flexShrink: 0 }}>
            <div style={{ display: "flex", fontFamily: FONT.mono, fontWeight: 700, fontSize: s(19, spec), color: C.primary }}>
              {r.label}
            </div>
            {r.sub && (
              <div style={{ display: "flex", fontFamily: FONT.mono, fontSize: s(13, spec), color: C.faint, marginTop: s(2, spec) }}>
                {r.sub}
              </div>
            )}
          </div>
          {r.magnitude != null ? (
            <div style={{ display: "flex", flex: 1, height: s(12, spec), background: "rgba(255,255,255,0.03)", marginRight: s(14, spec) }}>
              <div style={{ display: "flex", width: `${Math.max(3, (Math.abs(r.magnitude) / peak) * 100)}%`, height: "100%", background: r.color }} />
            </div>
          ) : (
            <div style={{ display: "flex", flex: 1 }} />
          )}
          <div
            style={{
              display: "flex",
              fontFamily: FONT.mono,
              fontWeight: 700,
              fontSize: s(21, spec),
              color: r.color,
              width: s(120, spec),
              flexShrink: 0,
              justifyContent: "flex-end",
            }}
          >
            {r.value}
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Take `limit` prints WITHOUT letting truncation turn a two-sided tape into a one-sided one.
 *
 * The rows arrive premium-ordered, and on a bullish tape that puts every call print ahead of every
 * put print. A cap of two then produced a card showing two call sweeps under a "+$18.4M net"
 * headline with the put flow invisible — technically the top two prints, and a directional claim
 * the tape does not support. Same failure the counterfactual card's `balancedRows` exists to
 * prevent, in a different block.
 *
 * Each side keeps its own premium order; a side with fewer prints than its share donates the
 * remainder rather than wasting it, so a genuinely one-sided tape still fills the card.
 */
export function balancedBySide<T extends { side: "call" | "put" }>(rows: readonly T[], limit: number): T[] {
  const calls = rows.filter((r) => r.side === "call");
  const puts = rows.filter((r) => r.side === "put");
  const half = Math.floor(limit / 2);
  const takeC = Math.min(calls.length, Math.max(half, limit - puts.length));
  const takeP = Math.min(puts.length, limit - takeC);
  const c = calls.slice(0, takeC);
  const p = puts.slice(0, takeP);
  const out: T[] = [];
  for (let i = 0; i < Math.max(c.length, p.length); i++) {
    if (c[i]) out.push(c[i]!);
    if (p[i]) out.push(p[i]!);
  }
  return out;
}

export function ComposedCard({
  bundle,
  spec,
  recorder,
  asOfLabel,
  composition,
}: {
  bundle: VisualBundle;
  spec: SizeSpec;
  recorder: ManifestRecorder;
  asOfLabel: string | null;
  composition: Composition;
}): ReactElement {
  const biasColor = bundle.bias === "bull" ? C.bull : bundle.bias === "bear" ? C.bear : C.primary;
  const surfaceCap = spec.dense ? 4 : spec.stack ? 7 : 5;

  /**
   * Rows THIS block was costed for.
   *
   * The packer shrinks blocks that would not otherwise fit and grows blocks into leftover budget,
   * and it charges the canvas for exactly those row counts. If the renderer re-derived the count
   * from the surface instead, a grown block would draw fewer rows than were paid for (wasting the
   * space the packer bought) and a shrunk one would draw more than were paid for — overflowing,
   * and losing whichever block sits at the bottom. Rendering to the plan is what makes the height
   * estimates mean anything.
   */
  const capFor = (b: (typeof composition.blocks)[number], fallback = surfaceCap) =>
    b.rowBudget ?? (b.compact ? Math.max(1, Math.floor(fallback / 2)) : fallback);

  const drawn: ReactElement[] = [];
  let first = true;
  const push = (el: ReactElement | null) => {
    if (!el) return;
    drawn.push(el);
    first = false;
  };

  for (const block of composition.blocks) {
    const isFirst = first;
    switch (block.id) {
      case "verdict":
        push(
          <div key="verdict" style={{ display: "flex", flexDirection: "column", width: "100%", marginTop: isFirst ? 0 : s(18, spec) }}>
            <Headline text={bundle.headline!} spec={spec} color={biasColor} />
            {bundle.summary && !spec.dense && (
              <div style={{ display: "flex", fontFamily: FONT.mono, fontSize: s(18, spec), color: C.muted, marginTop: s(12, spec), lineHeight: 1.5 }}>
                {bundle.summary}
              </div>
            )}
          </div>
        );
        break;

      case "spot":
        push(
          <div key="spot" style={{ display: "flex", alignItems: "flex-end", width: "100%", marginTop: isFirst ? 0 : s(16, spec) }}>
            <HeroNumber n={bundle.spot} label={bundle.ticker ? `${bundle.ticker} spot` : "Spot"} spec={spec} recorder={recorder} />
            {bundle.trade?.returnPct && (
              <div style={{ display: "flex", marginLeft: "auto" }}>
                <PnlBlock returnPct={bundle.trade.returnPct} graded={bundle.trade.graded} spec={spec} recorder={recorder} />
              </div>
            )}
          </div>
        );
        break;

      case "consensus":
        push(
          <Section key="consensus" label="What each system sees" spec={spec} first={isFirst}>
            <SystemStrip reads={bundle.systemReads} spec={spec} recorder={recorder} />
          </Section>
        );
        break;

      case "regime": {
        const r = bundle.regime!;
        recorder.value("Dealer regime", r.label, r.source);
        push(
          <Section key="regime" label="Dealer regime" spec={spec} first={isFirst}>
            <div style={{ display: "flex", alignItems: "baseline", width: "100%" }}>
              <div style={{ display: "flex", fontFamily: FONT.display, fontSize: s(40, spec), color: C.warn, lineHeight: 1 }}>
                {r.label}
              </div>
              {r.detail && (
                <div style={{ display: "flex", fontFamily: FONT.mono, fontSize: s(16, spec), color: C.muted, marginLeft: s(16, spec) }}>
                  {r.detail}
                </div>
              )}
            </div>
          </Section>
        );
        break;
      }

      case "levels":
        push(
          <Section key="levels" label="Dealer levels" spec={spec} first={isFirst}>
            <LevelMap levels={bundle.levels} spot={bundle.spot} spec={spec} recorder={recorder} max={capFor(block)} />
          </Section>
        );
        break;

      case "gex_shifts":
        push(
          <Section key="gex" label="Gamma change by strike" spec={spec} first={isFirst}>
            <GexBars shifts={bundle.gexShifts} spec={spec} recorder={recorder} max={capFor(block, spec.dense ? 3 : 5)} />
          </Section>
        );
        break;

      case "gamma_profile": {
        const gp = bundle.gammaProfile!;
        push(
          <Section key="gp" label={gp.flipStrike != null ? `Gamma profile · flip ${gp.flipStrike.toLocaleString("en-US")}` : "Gamma profile"} spec={spec} first={isFirst}>
            <GexBars
              shifts={gp.rows.map((r) => ({ strike: r.strike, change: r.gamma, display: r.display, direction: r.gamma >= 0 ? "stronger" : "weaker" }))}
              spec={spec}
              recorder={recorder}
              max={capFor(block, spec.dense ? 5 : 8)}
            />
          </Section>
        );
        break;
      }

      case "flow_tape": {
        const f = bundle.flow!;
        // HELIX is the flow product; the block carries no per-field source of its own.
        recorder.value("Net premium", f.netDisplay, "HELIX");
        if (f.grossDisplay) recorder.value("Gross premium", f.grossDisplay, "HELIX");
        if (f.printCount) recorder.value("Prints in window", String(f.printCount), "HELIX");
        push(
          <Section key="flow" label={`Flow · ${f.windowLabel ?? "recent"}`} spec={spec} first={isFirst}>
            <div style={{ display: "flex", flexDirection: "column", width: "100%" }}>
              <ChipRow
                items={[
                  // Direction read off the DISPLAY string's sign, because the block carries the
                  // formatted net rather than a raw number — and `fmtUsd` writes a true minus
                  // sign (U+2212), not a hyphen, so both are tested.
                  { label: "Net", value: f.netDisplay, color: /^[−-]/.test(f.netDisplay) ? C.bear : C.bull },
                  ...(f.grossDisplay ? [{ label: "Gross", value: f.grossDisplay, color: C.info }] : []),
                ]}
                spec={spec}
              />
              <div style={{ display: "flex", width: "100%", marginTop: s(9, spec) }}>
                <RankedRows
                  rows={balancedBySide(f.rows, capFor(block)).map((r) => ({
                    label: `${r.ticker}  ${r.side.toUpperCase()}`,
                    sub: r.detail ?? null,
                    value: r.premiumDisplay,
                    // No bar: the block carries no numeric premium to scale one against.
                    magnitude: null,
                    color: r.side === "put" ? C.bear : C.bull,
                  }))}
                  spec={spec}
                  max={capFor(block)}
                />
              </div>
            </div>
          </Section>
        );
        break;
      }

      case "playbook": {
        const pb = bundle.playbook!;
        push(
          <Section key="pb" label={`Playbook · ${pb.editionFor ?? "latest"}`} spec={spec} first={isFirst}>
            <div style={{ display: "flex", flexDirection: "column", width: "100%" }}>
              {pb.rows.slice(0, capFor(block, spec.dense ? 3 : surfaceCap)).map((r, i) => {
                recorder.value(
                  `#${r.rank} ${r.ticker}`,
                  [r.entryRange && `entry ${r.entryRange}`, r.target && `target ${r.target}`, r.stop && `stop ${r.stop}`].filter(Boolean).join(" · ") || r.direction,
                  pb.source
                );
                const accent = r.pulled ? C.warn : r.direction === "long" ? C.bull : C.bear;
                return (
                  <div
                    key={`${r.ticker}-${r.rank}`}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      width: "100%",
                      padding: `${s(9, spec)}px ${s(12, spec)}px`,
                      marginTop: i === 0 ? 0 : s(6, spec),
                      background: "rgba(255,255,255,0.02)",
                      borderLeft: `${s(3, spec)}px solid ${accent}`,
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        fontFamily: FONT.mono,
                        fontWeight: 700,
                        fontSize: s(20, spec),
                        color: r.pulled ? C.muted : C.primary,
                        width: s(120, spec),
                        flexShrink: 0,
                        textDecoration: r.pulled ? "line-through" : "none",
                      }}
                    >
                      {r.ticker}
                    </div>
                    <div style={{ display: "flex", fontFamily: FONT.mono, fontSize: s(16, spec), color: C.muted }}>
                      {[r.entryRange && `E ${r.entryRange}`, r.target && `T ${r.target}`, r.stop && `S ${r.stop}`].filter(Boolean).join("  ")}
                    </div>
                    <div
                      style={{
                        display: "flex",
                        marginLeft: "auto",
                        fontFamily: FONT.mono,
                        fontWeight: 700,
                        fontSize: s(18, spec),
                        color: r.pulled ? C.warn : C.info,
                        flexShrink: 0,
                      }}
                    >
                      {r.pulled ? "PULLED" : r.entryPremiumDisplay ?? r.direction.toUpperCase()}
                    </div>
                  </div>
                );
              })}
            </div>
          </Section>
        );
        break;
      }

      case "trade": {
        const t = bundle.trade!;
        recorder.value("Ticker", t.ticker, t.source);
        push(
          <Section key="trade" label="Position" spec={spec} first={isFirst}>
            <ChipRow
              items={[
                { label: t.ticker, value: t.direction.toUpperCase(), color: t.direction === "long" ? C.bull : C.bear },
                ...(t.entry ? [{ label: "Entry", value: t.entry.display, color: C.primary }] : []),
                ...(t.exit ? [{ label: t.graded ? "Exit" : "Mark", value: t.exit.display, color: t.graded ? C.primary : C.warn }] : []),
                ...(t.returnPct
                  ? [{ label: t.graded ? "Booked" : "Live P&L", value: t.returnPct.display, color: t.returnPct.value >= 0 ? C.bull : C.bear }]
                  : []),
              ]}
              spec={spec}
            />
          </Section>
        );
        break;
      }

      case "leaderboard": {
        const lb = bundle.leaderboard!;
        recorder.value("Graded", String(lb.graded), lb.source);
        recorder.value("Wins", String(lb.wins), lb.source);
        recorder.value("Losses", String(lb.losses), lb.source);
        push(
          <Section key="lb" label={`Graded results · ${lb.windowLabel}`} spec={spec} first={isFirst}>
            <div style={{ display: "flex", flexDirection: "column", width: "100%" }}>
              {/* THE DENOMINATOR IS NOT OPTIONAL. Five winners out of forty trades is a true card
                  and a dishonest one unless the forty is on it — the same rule the designed
                  leaderboard enforces, restated here because a composed card could otherwise
                  render the rows without it. */}
              <ChipRow
                items={[
                  { label: "Graded", value: String(lb.graded), color: C.primary },
                  { label: "Wins", value: String(lb.wins), color: C.bull },
                  { label: "Losses", value: String(lb.losses), color: C.bear },
                  ...(lb.winRateDisplay ? [{ label: "Win rate", value: lb.winRateDisplay, color: C.info }] : []),
                ]}
                spec={spec}
              />
              <div style={{ display: "flex", width: "100%", marginTop: s(9, spec) }}>
                <RankedRows
                  rows={lb.rows.map((r) => {
                    recorder.value(`${r.ticker} booked`, r.returnDisplay, lb.source);
                    return {
                      label: r.ticker,
                      sub: [r.dateLabel, r.contract].filter(Boolean).join(" · ") || null,
                      value: r.returnDisplay,
                      magnitude: r.returnValue,
                      color: r.returnValue >= 0 ? C.bull : C.bear,
                    };
                  })}
                  spec={spec}
                  max={capFor(block)}
                />
              </div>
            </div>
          </Section>
        );
        break;
      }

      case "screen": {
        const sc = bundle.screen!;
        recorder.value("Universe size", String(sc.universeSize), "VECTOR", sc.updatedAt);
        push(
          <Section key="screen" label={`${sc.preset} · ${sc.universeSize} names`} spec={spec} first={isFirst}>
            <RankedRows
              rows={sc.rows.map((r) => {
                recorder.value(r.ticker, r.metricDisplay, "VECTOR");
                return {
                  label: r.ticker,
                  sub: null,
                  value: r.metricDisplay,
                  magnitude: r.metricValue,
                  color: r.regime === "above" ? C.bull : r.regime === "below" ? C.bear : C.muted,
                };
              })}
              spec={spec}
              max={capFor(block, surfaceCap + 2)}
            />
          </Section>
        );
        break;
      }

      case "rejections": {
        const rj = bundle.rejections!;
        recorder.value("Setups held", String(rj.total), "NIGHT HAWK");
        push(
          <Section key="rej" label={`Held by the gates · ${rj.windowLabel ?? "recent"} · ${rj.total} total`} spec={spec} first={isFirst}>
            <div style={{ display: "flex", flexDirection: "column", width: "100%" }}>
              {rj.rows.slice(0, capFor(block)).map((r, i) => {
                recorder.value(`${r.ticker} held`, r.gateFailed, "NIGHT HAWK");
                return (
                  <div
                    key={`${r.ticker}-${i}`}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      width: "100%",
                      padding: `${s(8, spec)}px ${s(12, spec)}px`,
                      marginTop: i === 0 ? 0 : s(5, spec),
                      background: "rgba(255,255,255,0.015)",
                      borderLeft: `${s(3, spec)}px solid ${C.warn}`,
                    }}
                  >
                    <div style={{ display: "flex", fontFamily: FONT.mono, fontWeight: 700, fontSize: s(18, spec), color: C.primary, width: s(140, spec), flexShrink: 0 }}>
                      {r.ticker}
                    </div>
                    <div style={{ display: "flex", fontFamily: FONT.mono, fontSize: s(16, spec), color: C.warn }}>{r.gateFailed}</div>
                  </div>
                );
              })}
            </div>
          </Section>
        );
        break;
      }

      case "session": {
        const se = bundle.session!;
        push(
          <Section key="session" label="Session" spec={spec} first={isFirst}>
            <ChipRow
              items={[
                { label: "Open", value: se.openDisplay!, color: C.muted },
                { label: "High", value: se.highDisplay!, color: C.bull },
                { label: "Low", value: se.lowDisplay!, color: C.bear },
                { label: "Close", value: se.closeDisplay!, color: C.primary },
              ]}
              spec={spec}
            />
          </Section>
        );
        break;
      }

      case "timeline":
        push(
          <Section key="tl" label="Sequence" spec={spec} first={isFirst}>
            <Timeline steps={bundle.timeline} spec={spec} recorder={recorder} />
          </Section>
        );
        break;

      case "generic_events": {
        const ev = bundle.genericEvents!;
        push(
          <Section key="gev" label={ev.title} spec={spec} first={isFirst}>
            <div style={{ display: "flex", flexDirection: "column", width: "100%" }}>
              {ev.rows.slice(0, capFor(block, spec.dense ? 4 : 6)).map((r, i) => {
                recorder.value(`${r.label} ${r.when}`, r.detail ?? r.when, ev.source);
                return (
                  <div
                    key={`${r.label}-${i}`}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      width: "100%",
                      padding: `${s(7, spec)}px ${s(12, spec)}px`,
                      marginTop: i === 0 ? 0 : s(5, spec),
                      background: "rgba(255,255,255,0.015)",
                      borderLeft: `${s(3, spec)}px solid ${C.info}`,
                    }}
                  >
                    <div style={{ display: "flex", fontFamily: FONT.mono, fontWeight: 700, fontSize: s(17, spec), color: C.info, width: s(84, spec), flexShrink: 0 }}>
                      {r.when}
                    </div>
                    <div style={{ display: "flex", fontFamily: FONT.mono, fontWeight: 700, fontSize: s(18, spec), color: C.primary }}>
                      {r.label}
                    </div>
                    {r.detail && (
                      <div style={{ display: "flex", marginLeft: "auto", fontFamily: FONT.mono, fontSize: s(15, spec), color: C.muted, flexShrink: 0 }}>
                        {r.detail}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </Section>
        );
        break;
      }

      case "generic_ranked": {
        const gr = bundle.genericRanked!;
        push(
          <Section key="grk" label={gr.title} spec={spec} first={isFirst}>
            <RankedRows
              rows={gr.rows.map((r) => {
                recorder.value(r.label, r.value, gr.source);
                return {
                  label: r.label,
                  sub: r.sub ?? null,
                  value: r.value,
                  magnitude: r.magnitude,
                  // Signed values carry direction; unsigned ones are magnitudes and stay neutral,
                  // because colouring a raw volume green would assert a direction the data has not.
                  color: r.magnitude > 0 ? C.bull : r.magnitude < 0 ? C.bear : C.muted,
                };
              })}
              spec={spec}
              max={capFor(block, surfaceCap + 2)}
            />
          </Section>
        );
        break;
      }

      case "generic_stats": {
        const gs = bundle.genericStats!;
        // Four per row wide, two stacked — matching the height the packer was charged for.
        const perRow = spec.stack ? 2 : 4;
        const shown = gs.rows.slice(0, spec.dense ? 4 : 8);
        const chunks: (typeof shown)[] = [];
        for (let i = 0; i < shown.length; i += perRow) chunks.push(shown.slice(i, i + perRow));
        for (const r of shown) recorder.value(r.label, r.value, gs.source);
        push(
          <Section key="gst" label={gs.title} spec={spec} first={isFirst}>
            <div style={{ display: "flex", flexDirection: "column", width: "100%" }}>
              {chunks.map((chunk, ci) => (
                <div key={ci} style={{ display: "flex", width: "100%", marginTop: ci === 0 ? 0 : s(9, spec) }}>
                  {chunk.map((r, i) => (
                    <div
                      key={r.label}
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        flex: 1,
                        marginLeft: i === 0 ? 0 : s(12, spec),
                        padding: s(11, spec),
                        background: "rgba(255,255,255,0.02)",
                        borderTop: `${s(2, spec)}px solid ${C.info}`,
                      }}
                    >
                      <Kicker text={r.label} spec={spec} />
                      <div
                        style={{
                          display: "flex",
                          fontFamily: FONT.mono,
                          fontWeight: 700,
                          fontSize: s(26, spec),
                          color: C.primary,
                          marginTop: s(5, spec),
                        }}
                      >
                        {r.value}
                      </div>
                    </div>
                  ))}
                  {/* Pad the final row so three tiles do not stretch to fill four columns —
                      a stretched tile reads as a different, more important measurement. */}
                  {chunk.length < perRow &&
                    Array.from({ length: perRow - chunk.length }, (_, k) => (
                      <div key={`pad-${k}`} style={{ display: "flex", flex: 1, marginLeft: s(12, spec) }} />
                    ))}
                </div>
              ))}
            </div>
          </Section>
        );
        break;
      }

      case "metrics":
        push(
          <Section key="metrics" label={null} spec={spec} first={isFirst}>
            <MetricRow metrics={bundle.metrics} spec={spec} recorder={recorder} max={spec.stack ? 2 : 4} />
          </Section>
        );
        break;

      // Blocks whose designed template is the better renderer are eligible for SELECTION (so they
      // can win a card outright through the router) but are not drawn inline here. Falling through
      // silently is correct: `composeCard` already reported them, and re-implementing a
      // counterfactual's symmetric-columns honesty layout as a generic section would lose exactly
      // the property that makes it publishable.
      default:
        break;
    }
  }

  const droppedLabels = composition.dropped.map((d) => d.label);

  const children: (ReactElement | null)[] = [
    <CardHeader
      key="head"
      systems={bundle.systemsQueried.filter((x) => x !== "LARGO")}
      asOfLabel={asOfLabel}
      freshness={bundle.freshness}
      spec={spec}
    />,
    <div key="body" style={{ display: "flex", flexDirection: "column", width: "100%", marginTop: s(18, spec) }}>
      {drawn}
    </div>,
    droppedLabels.length ? (
      <div key="dropped" style={{ display: "flex", marginTop: s(12, spec) }}>
        <Kicker text={`Also measured, no room on this card: ${droppedLabels.join(" · ")}`} spec={spec} />
      </div>
    ) : null,
  ];

  return (
    <CardShell
      spec={spec}
      footer={<CardFooter attribution={bundle.systemsQueried.filter((x) => x !== "LARGO").join(" · ")} spec={spec} />}
    >
      {children.filter(Boolean) as ReactElement[]}
    </CardShell>
  );
}
