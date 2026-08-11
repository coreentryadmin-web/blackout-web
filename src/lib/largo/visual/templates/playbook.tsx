/**
 * PLAYBOOK — the forward runbook. Every published play, with the levels you would actually trade.
 *
 * THE CARD THAT DID NOT EXIST. Asked "give me tomorrow's Night Hawk plays", the library's closest
 * match was TRADE_RECAP, which is singular and reads exit/return fields a play that has not been
 * taken does not have. The result was one ticker and one number on an otherwise empty canvas — a
 * correct answer in the prose beside a card that contradicted it. See `types.ts` on `playbook`.
 *
 * FOUR RULES, and the first two are safety rules rather than design ones.
 *
 * 1. A PULLED PLAY IS RENDERED, STRUCK THROUGH, WITH ITS REASON. The morning confirmation can
 *    INVALIDATE a published play, and the engine latches that one-way (`pull-overlay.ts`). Dropping
 *    those rows would produce the single most harmful graphic this system can make: a runbook
 *    telling a member to take a trade the desk has publicly withdrawn. `PlaybookPlay`'s own type
 *    comment says "never hidden, never deleted"; this is that rule at the pixel layer.
 *
 * 2. A GATE-PROMOTED PLAY IS BADGED. It reached the edition without clearing the publish gates,
 *    because the pipeline would otherwise have published zero. Presented unmarked beside four
 *    clean plays it reads as equally validated, which is exactly the claim it cannot support.
 *
 * 3. TRUNCATION IS STATED, NEVER SILENT. A landscape card cannot fit five plays at legible size.
 *    It shows what fits and says how many exist — the same rule the leaderboard and counterfactual
 *    cards follow, and the repo's standing "no silent caps" principle.
 *
 * 4. LEVELS ARE QUOTED VERBATIM. `entry_range`, `target` and `stop` are strings the engine
 *    composed; they are printed, never re-parsed into numbers and re-formatted. A runbook whose
 *    levels differ by a rounding step from the ones on the desk is worse than no runbook.
 */

import type { ReactElement } from "react";
import { C, FONT } from "../tokens";
import type { SizeSpec } from "../sizes";
import { s } from "../sizes";
import type { ManifestRecorder } from "../manifest";
import type { VisualBundle } from "../types";
import { CardFooter, CardHeader, CardShell, Kicker } from "../primitives";

type Row = NonNullable<VisualBundle["playbook"]>["rows"][number];

/**
 * How many plays fit at legible size on this surface.
 *
 * A runbook's whole value is that a member can read the levels off it, so the cap is set by
 * legibility rather than by how many rows can technically be stacked. Landscape is the tight case:
 * 630px minus chrome and footer leaves room for three full rows, and a fourth would force the type
 * below the size at which a strike price can be read on a phone.
 */
export function playbookCapacity(spec: SizeSpec): number {
  if (spec.dense) return 3;
  return spec.stack ? 6 : 5;
}

/**
 * BOOK-LEVEL ARITHMETIC — what taking the whole book actually costs and risks.
 *
 * Every value here is derived from the plays' own numbers, and each is `null` when its inputs are
 * absent rather than defaulting to zero: a book cost of "$0" would read as free rather than as
 * unknown, which is the same omission rule the rest of the bundle follows.
 *
 * PULLED PLAYS ARE EXCLUDED FROM THE COST AND THE R:R, and that is the point of computing this
 * here rather than inline — a withdrawn play is not capital you would deploy, so folding it into
 * "cost to take the book" would overstate the commitment by exactly the plays the desk told you
 * not to take. `pulledCount` is reported separately so the exclusion is visible, not silent.
 */
export function bookStats(rows: Row[]): {
  actionable: number;
  pulledCount: number;
  costPerLot: number | null;
  avgRr: number | null;
  widestTargetAtr: number | null;
} {
  const live = rows.filter((r) => !r.pulled);
  const premiums = live.map((r) => r.entryPremium).filter((n): n is number => n != null);
  const rrs = live.map((r) => r.rrRatio).filter((n): n is number => n != null);
  const atrs = live.map((r) => r.targetAtrMultiple).filter((n): n is number => n != null);
  return {
    actionable: live.length,
    pulledCount: rows.length - live.length,
    // One contract per play. The standard option multiplier, stated on the card so the unit is
    // never ambiguous — a bare dollar figure beside per-share premiums invites a 100× misread.
    costPerLot: premiums.length ? premiums.reduce((a, b) => a + b, 0) * 100 : null,
    avgRr: rrs.length ? rrs.reduce((a, b) => a + b, 0) / rrs.length : null,
    // The WORST reachability on the book, not the average — one target 3× ATR away is the play
    // that will not fill, and averaging hides it behind four reachable ones.
    widestTargetAtr: atrs.length ? Math.max(...atrs) : null,
  };
}

/**
 * The plays to draw, PULLED ONES FIRST.
 *
 * Ordering by rank alone would let a truncated card drop the pulled play — the one row a member
 * most needs to see, because it is the one that changes what they do. So an invalidated play is
 * promoted to the front of the render order regardless of its published rank; its rank is still
 * printed, so the edition's own ordering is never misrepresented.
 */
export function playbookRenderOrder(rows: Row[], limit: number): Row[] {
  const pulled = rows.filter((r) => r.pulled);
  const live = rows.filter((r) => !r.pulled);
  return [...pulled, ...live].slice(0, limit);
}

/** A level cell: label above, engine string below, colour-coded by role. */
function LevelCell({
  label,
  value,
  color,
  spec,
  width,
}: {
  label: string;
  value: string | null;
  color: string;
  spec: SizeSpec;
  width?: number;
}): ReactElement | null {
  if (!value) return null;
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        ...(width ? { width, flexShrink: 0 } : { flex: 1 }),
      }}
    >
      <div
        style={{
          display: "flex",
          fontFamily: FONT.mono,
          fontSize: s(12, spec),
          letterSpacing: s(2, spec),
          textTransform: "uppercase",
          color: C.faint,
        }}
      >
        {label}
      </div>
      <div
        style={{
          display: "flex",
          fontFamily: FONT.mono,
          fontWeight: 700,
          fontSize: s(20, spec),
          color,
          marginTop: s(3, spec),
        }}
      >
        {value}
      </div>
    </div>
  );
}

export function PlaybookCard({
  bundle,
  spec,
  recorder,
  asOfLabel,
}: {
  bundle: VisualBundle;
  spec: SizeSpec;
  recorder: ManifestRecorder;
  asOfLabel: string | null;
}): ReactElement {
  const pb = bundle.playbook!;
  const rows = playbookRenderOrder(pb.rows, playbookCapacity(spec));

  const longs = pb.rows.filter((r) => r.direction === "long" && !r.pulled).length;
  const shorts = pb.rows.filter((r) => r.direction === "short" && !r.pulled).length;
  const stats = bookStats(pb.rows);
  const pulledCount = stats.pulledCount;

  recorder.value("Edition for", pb.editionFor ?? "unknown", pb.source, pb.publishedAt);
  recorder.value("Plays published", String(pb.totalPlays), pb.source);
  if (pulledCount > 0) recorder.value("Plays pulled", String(pulledCount), pb.source);

  // The book's own skew, stated once at the top. A five-play all-long book is a directional bet
  // whether or not any single card says so, and a member reading three of five rows cannot infer
  // it. Counted over ALL plays, not the rendered subset.
  const skew =
    longs > 0 && shorts === 0 ? "ALL LONG" : shorts > 0 && longs === 0 ? "ALL SHORT" : `${longs} LONG · ${shorts} SHORT`;
  const skewColor = shorts === 0 ? C.bull : longs === 0 ? C.bear : C.warn;
  recorder.value("Book skew", skew, pb.source);

  const children: (ReactElement | null)[] = [
    <CardHeader key="h" systems={[pb.source]} asOfLabel={asOfLabel} freshness={bundle.freshness} spec={spec} />,

    <div key="t" style={{ display: "flex", flexDirection: "column", marginTop: s(18, spec) }}>
      <Kicker text={`Playbook · ${pb.editionFor ?? "latest edition"}`} spec={spec} color={C.ai} />
      <div style={{ display: "flex", alignItems: "center", marginTop: s(8, spec) }}>
        <div style={{ display: "flex", fontFamily: FONT.display, fontSize: s(spec.dense ? 60 : 72, spec), color: C.primary, lineHeight: 1 }}>
          {`${pb.totalPlays} ${pb.totalPlays === 1 ? "PLAY" : "PLAYS"}`}
        </div>
        <div
          style={{
            display: "flex",
            fontFamily: FONT.mono,
            fontWeight: 700,
            fontSize: s(17, spec),
            letterSpacing: s(3, spec),
            color: C.void,
            background: skewColor,
            padding: `${s(6, spec)}px ${s(12, spec)}px`,
            marginLeft: s(16, spec),
          }}
        >
          {skew}
        </div>
      </div>
    </div>,

    /**
     * THE BOOK STRIP — what taking every play costs and risks, in one line.
     *
     * A runbook that lists five entries without ever stating the total is asking a member to do
     * the arithmetic that decides whether they can take the book at all. Each tile is omitted
     * individually when its inputs are missing, so the strip degrades tile by tile rather than
     * disappearing or printing a zero.
     */
    (() => {
      const tiles = [
        stats.costPerLot != null
          ? {
              label: "Book cost · 1 lot",
              value: `$${Math.round(stats.costPerLot).toLocaleString("en-US")}`,
              color: C.info,
              sub: `${stats.actionable} actionable`,
            }
          : null,
        stats.avgRr != null
          ? { label: "Avg R:R", value: `${stats.avgRr.toFixed(1)}:1`, color: C.bull, sub: "across live plays" }
          : null,
        stats.widestTargetAtr != null
          ? {
              label: "Furthest target",
              value: `${stats.widestTargetAtr.toFixed(1)}× ATR`,
              // Amber past 1.5×: the measured one-session touch rate collapses beyond it, so the
              // widest target on the book is a reachability warning rather than a neutral stat.
              color: stats.widestTargetAtr > 1.5 ? C.warn : C.muted,
              sub: stats.widestTargetAtr > 1.5 ? "low touch rate" : "within a session",
            }
          : null,
        pulledCount > 0
          ? { label: "Pulled", value: String(pulledCount), color: C.warn, sub: "non-actionable" }
          : null,
      ].filter(Boolean) as { label: string; value: string; color: string; sub: string }[];

      if (!tiles.length) {
        recorder.omit("book totals");
        return null;
      }
      for (const t of tiles) recorder.value(t.label, t.value, pb.source);

      // The `sub` lines are dropped on dense surfaces. Measured: with them, the landscape card
      // overflowed and lost its third play AND the "showing 3 of 5" line — i.e. the strip's
      // explanatory text cost a whole row of the runbook and the notice that a row was missing.
      // The numbers are what the strip is for; the captions are the part that can go.
      const withSub = !spec.dense;
      return (
        <div key="stats" style={{ display: "flex", width: "100%", marginTop: s(12, spec) }}>
          {tiles.map((t, i) => (
            <div
              key={t.label}
              style={{
                display: "flex",
                flexDirection: "column",
                flex: 1,
                marginLeft: i === 0 ? 0 : s(12, spec),
                padding: `${s(withSub ? 11 : 8, spec)}px ${s(11, spec)}px`,
                background: "rgba(255,255,255,0.02)",
                borderTop: `${s(2, spec)}px solid ${t.color}`,
              }}
            >
              <Kicker text={t.label} spec={spec} />
              <div
                style={{
                  display: "flex",
                  fontFamily: FONT.mono,
                  fontWeight: 700,
                  fontSize: s(withSub ? 28 : 24, spec),
                  color: t.color,
                  marginTop: s(4, spec),
                }}
              >
                {t.value}
              </div>
              {withSub && (
                <div style={{ display: "flex", fontFamily: FONT.mono, fontSize: s(13, spec), color: C.faint, marginTop: s(4, spec) }}>
                  {t.sub}
                </div>
              )}
            </div>
          ))}
        </div>
      );
    })(),

    /**
     * PROVENANCE WARNINGS, above the plays rather than in a footnote.
     *
     * `stale` means the member is looking at an OLDER session's edition because tonight's has not
     * published; `degraded` means it came from a fallback source. Both change what the levels below
     * are worth, so both sit where they cannot be missed. Rendered only when true.
     */
    pb.stale || pb.degraded || pb.noPlays ? (
      <div
        key="warn"
        style={{
          display: "flex",
          alignItems: "center",
          width: "100%",
          marginTop: s(12, spec),
          padding: s(10, spec),
          background: "rgba(251,191,36,0.08)",
          borderLeft: `${s(3, spec)}px solid ${C.warn}`,
        }}
      >
        <div style={{ display: "flex", fontFamily: FONT.mono, fontSize: s(15, spec), color: C.warn }}>
          {pb.noPlays
            ? "Edition published with no plays — nothing cleared the bar"
            : pb.stale
              ? "Showing an earlier edition — this session's is not published yet"
              : "Degraded source — not the first-class published pipeline"}
        </div>
      </div>
    ) : null,

    <div key="rows" style={{ display: "flex", flexDirection: "column", width: "100%", marginTop: s(16, spec) }}>
      {rows.map((r, i) => {
        const long = r.direction === "long";
        const dirColor = long ? C.bull : C.bear;
        // A pulled play is drawn in the caution palette, not its direction palette — the side no
        // longer matters once the play is withdrawn, and colouring it bull green would read as live.
        const accent = r.pulled ? C.warn : dirColor;

        recorder.value(
          `#${r.rank} ${r.ticker} ${r.direction}`,
          [r.entryRange && `entry ${r.entryRange}`, r.target && `target ${r.target}`, r.stop && `stop ${r.stop}`]
            .filter(Boolean)
            .join(" · ") || "levels unavailable",
          pb.source
        );

        return (
          <div
            key={`${r.ticker}-${r.rank}`}
            style={{
              display: "flex",
              flexDirection: "column",
              width: "100%",
              marginTop: i === 0 ? 0 : s(8, spec),
              padding: `${s(spec.dense ? 8 : 10, spec)}px ${s(13, spec)}px`,
              background: r.pulled ? "rgba(251,191,36,0.05)" : "rgba(255,255,255,0.02)",
              borderLeft: `${s(4, spec)}px solid ${accent}`,
            }}
          >
            {/* Identity line: rank · ticker · side · contract · premium */}
            <div style={{ display: "flex", alignItems: "center", width: "100%" }}>
              <div
                style={{
                  display: "flex",
                  fontFamily: FONT.mono,
                  fontSize: s(15, spec),
                  color: C.faint,
                  width: s(34, spec),
                  flexShrink: 0,
                }}
              >
                {`#${r.rank}`}
              </div>
              <div
                style={{
                  display: "flex",
                  fontFamily: FONT.display,
                  fontSize: s(34, spec),
                  color: r.pulled ? C.muted : C.primary,
                  lineHeight: 1,
                  // Struck through, so the withdrawal survives a glance at a thumbnail where the
                  // amber accent and the badge might both be missed.
                  textDecoration: r.pulled ? "line-through" : "none",
                }}
              >
                {r.ticker}
              </div>
              <div
                style={{
                  display: "flex",
                  fontFamily: FONT.mono,
                  fontWeight: 700,
                  fontSize: s(13, spec),
                  letterSpacing: s(2, spec),
                  color: C.void,
                  background: accent,
                  padding: `${s(4, spec)}px ${s(8, spec)}px`,
                  marginLeft: s(11, spec),
                  flexShrink: 0,
                }}
              >
                {r.pulled ? "PULLED" : r.direction.toUpperCase()}
              </div>
              {r.gatePromoted && !r.pulled && (
                <div
                  style={{
                    display: "flex",
                    fontFamily: FONT.mono,
                    fontWeight: 700,
                    fontSize: s(12, spec),
                    letterSpacing: s(2, spec),
                    color: C.warn,
                    border: `1px solid ${C.warn}`,
                    padding: `${s(3, spec)}px ${s(7, spec)}px`,
                    marginLeft: s(8, spec),
                    flexShrink: 0,
                  }}
                >
                  GATE-PROMOTED
                </div>
              )}
              {r.earningsRisk && !r.pulled && (
                <div
                  style={{
                    display: "flex",
                    fontFamily: FONT.mono,
                    fontWeight: 700,
                    fontSize: s(12, spec),
                    letterSpacing: s(2, spec),
                    color: C.bear,
                    border: `1px solid ${C.bear}`,
                    padding: `${s(3, spec)}px ${s(7, spec)}px`,
                    marginLeft: s(8, spec),
                    flexShrink: 0,
                  }}
                >
                  EARNINGS
                </div>
              )}
              {r.optionsPlay && (
                <div
                  style={{
                    display: "flex",
                    fontFamily: FONT.mono,
                    fontSize: s(16, spec),
                    color: C.muted,
                    marginLeft: s(12, spec),
                  }}
                >
                  {r.optionsPlay}
                </div>
              )}
              {r.entryPremiumDisplay && (
                <div
                  style={{
                    display: "flex",
                    marginLeft: "auto",
                    fontFamily: FONT.mono,
                    fontWeight: 700,
                    fontSize: s(22, spec),
                    color: r.pulled ? C.muted : C.info,
                    flexShrink: 0,
                  }}
                >
                  {r.entryPremiumDisplay}
                </div>
              )}
            </div>

            {/* THE RUNBOOK LINE — the reason this card exists. Entry, target, stop, R:R, ATR. */}
            <div style={{ display: "flex", alignItems: "flex-end", width: "100%", marginTop: s(8, spec) }}>
              <LevelCell label="Entry" value={r.entryRange} color={C.primary} spec={spec} />
              <LevelCell label="Target" value={r.target} color={C.bull} spec={spec} />
              <LevelCell label="Stop" value={r.stop} color={C.bear} spec={spec} />
              <LevelCell
                label="R:R"
                value={r.rrRatio != null ? `${r.rrRatio.toFixed(1)}:1` : null}
                color={C.info}
                spec={spec}
                width={s(80, spec)}
              />
              {/* Target distance in ATR units. Surfaced because the Legacy lane grades on ONE daily
                  bar, so this IS reachability — the measured one-session touch rate falls off a
                  cliff past ~1.5×. The gate already computed it; showing the dollar level alone
                  hides how far away it is. */}
              <LevelCell
                label="Tgt ATR"
                value={r.targetAtrMultiple != null ? `${r.targetAtrMultiple.toFixed(1)}×` : null}
                color={r.targetAtrMultiple != null && r.targetAtrMultiple > 1.5 ? C.warn : C.muted}
                spec={spec}
                width={s(82, spec)}
              />
            </div>

            {/* One line of WHY. A runbook of levels with no thesis is a signal bot; the thesis is
                what a member checks the next morning to decide the play still makes sense. Dropped
                on dense surfaces, where the levels are the thing that must stay legible. */}
            {!spec.dense && (r.pulled ? r.pulledReason : r.keySignal ?? r.thesis) && (
              <div
                style={{
                  display: "flex",
                  fontFamily: FONT.mono,
                  fontSize: s(14, spec),
                  color: r.pulled ? C.warn : C.muted,
                  marginTop: s(7, spec),
                }}
              >
                {(() => {
                  const text = (r.pulled ? r.pulledReason : r.keySignal ?? r.thesis) ?? "";
                  const cap = spec.stack ? 116 : 92;
                  const body = text.length > cap ? `${text.slice(0, cap - 1).trimEnd()}…` : text;
                  return r.pulled ? `Pulled — ${body}` : body;
                })()}
              </div>
            )}
          </div>
        );
      })}
    </div>,

    <div key="note" style={{ display: "flex", marginTop: s(12, spec) }}>
      <Kicker
        text={
          rows.length < pb.rows.length
            ? `Showing ${rows.length} of ${pb.totalPlays} plays${pulledCount ? ` · ${pulledCount} pulled, shown first` : ""} · full book on the desk`
            : pulledCount
              ? `All ${pb.totalPlays} plays · ${pulledCount} pulled and non-actionable`
              : `All ${pb.totalPlays} published plays`
        }
        spec={spec}
      />
    </div>,
  ];

  return (
    <CardShell
      spec={spec}
      footer={<CardFooter attribution="Night Hawk edition · levels as published" spec={spec} />}
    >
      {children.filter(Boolean) as ReactElement[]}
    </CardShell>
  );
}
