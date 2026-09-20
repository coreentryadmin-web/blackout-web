/**
 * Extended trade-manager coaching bullets — folds intel-section data into Largo narrative.
 * Pure + deterministic. Consumed by play-brief-narrative.ts.
 */
import type { TerminalPlay } from "@/features/nighthawk/command-deck/types";
import {
  collectOptionMarkStalenessAbsence,
  ageSecondsLabel,
  confluenceZoneKindsLabel,
  fundamentalsAncient,
  gexMatrixAgeMs,
  gexMatrixStale,
  resolveGammaPosture,
  vectorAgeStale,
  vectorSnapshotStale,
} from "./play-brief-absence";
import type { SwingPlayBriefContext } from "./play-brief-types";
import type { VectorFullState } from "@/lib/bie/vector-full-state";
import { computeLaneRank } from "./play-brief-lane-rank";
import { fmtOptionUsd, fmtPremium } from "@/lib/fmt-money";
import { nighthawkLiveForSession, trustedHelixFlow, zerodteLiveForSession } from "./play-brief-absence";
import { mfeCaptureOutcome } from "./mfe-capture";
import { thesisHealthUncalibrated } from "./thesis-health";
import { technicalsBias } from "./play-brief-technicals";
import { formatFixedNonZero } from "./format-nonzero";
import { ARCHETYPE_META, type SwingArchetype } from "./taxonomy";
import { deadPlayReason } from "./entry-enterability";
import { etStampFromDateOrIso, parseEtStamp } from "@/lib/largo/temporal/bar-session-date";

function fin(n: unknown): number | null {
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

function fmtPct(n: number, digits = 1): string {
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(digits)}%`;
}

function vectorOf(ctx: SwingPlayBriefContext): VectorFullState | null {
  return ctx.vector ?? ctx.ecosystem?.vector_full_state ?? null;
}

/** Urgent thesis invalidation — leads narrative when fired. */
export function thesisBreakCoaching(play: TerminalPlay): string | null {
  if (thesisHealthUncalibrated(play.thesisHealth)) return null;
  const level = play.thesisBreak?.level ?? play.thesisHealth?.thesisBreakLevel;
  const note = play.thesisBreak?.note ?? play.thesisHealth?.thesisBreakNote;
  if (!level || level === "unknown" || level === "intact") return null;

  if (level === "break") {
    return `**Thesis BREAK** — ${note ?? "structural invalidation fired"}. Exit or cut to runner only; don't add size.`;
  }
  return `**Thesis WARN** — ${note ?? "pillars fading"}. Tighten stops; next trim rail is your friend.`;
}

/** Weakest / fading pillar — explains the health % number. */
export function thesisPillarCoaching(play: TerminalPlay): string | null {
  const h = play.thesisHealth;
  if (!h?.pillars?.length) return null;
  if (thesisHealthUncalibrated(h)) return null;

  const faded = h.pillars
    .filter((p) => p.status === "lost" || p.status === "faded")
    .sort((a, b) => (a.deltaPts ?? 0) - (b.deltaPts ?? 0));

  if (faded.length) {
    const p = faded[0]!;
    const delta = p.deltaPts != null ? ` (Δ ${p.deltaPts >= 0 ? "+" : ""}${p.deltaPts} pts)` : "";
    return `**Pillar fade** — **${p.label}** drifted ${p.commitLabel} → **${p.currentLabel}**${delta}. ${h.advisory ?? ""}`.trim();
  }

  if (h.moves?.length && !h.moves[0]?.includes("unchanged")) {
    return `**What moved** — ${h.moves.slice(0, 2).join(" · ")}.`;
  }

  if (!thesisHealthUncalibrated(h) && h.health < 55 && h.advisory) {
    return `**Thesis ${h.rungLabel}** (${h.health}%) — ${h.advisory}`;
  }

  return null;
}

/**
 * ENHANCEMENT (2026-09-15, Ask Largo standing mandate, forensic batch 33 — dedicated narrative-
 * quality pass): `play.trough` (the position's own worst intra-trade excursion) is rendered once,
 * as a bare number, in the Position section (play-brief.ts) — but nothing in the narrative ever
 * INTERPRETS it. Live repro: CG round-tripped from -34.6% to +221.2%; CRWD (the board's #1-ranked,
 * largest open winner) from -57.2% to +161.3% peak. That is real, conviction-relevant volatility a
 * trade manager would cite ("this one tested you early, don't flinch on the next drawdown scare" /
 * "this name doesn't sit still, bank into strength") — the exact kind of engineering investment the
 * sibling "Round-tripped past breakeven" giveback coaching already got (mfeCaptureOutcome, peak-vs-
 * current), but trough-vs-peak never received the same treatment. Only fires for a real, meaningful
 * swing (peak-minus-trough >= 40 pts AND the position actually traded negative at some point) — a
 * shallow trough is not conviction-relevant, and firing on every position would just be noise.
 * OPEN-only: a CLOSED play's own "Lessons" section (`closedCoaching`, below) carries the
 * equivalent post-mortem trough disclosure so this doesn't duplicate it — see that function's
 * own 2026-09-18 fix comment for why this claim previously did NOT hold in practice.
 */
export function troughResilienceCoaching(play: TerminalPlay, bucket: "watch" | "open" | "closed"): string | null {
  if (bucket !== "open") return null;
  const trough = play.trough;
  const peak = play.peak;
  if (typeof trough !== "number" || !Number.isFinite(trough)) return null;
  if (typeof peak !== "number" || !Number.isFinite(peak)) return null;
  if (trough >= 0) return null;
  const swing = peak - trough;
  if (swing < 40) return null;
  return `**Volatility note** — this position swung from **${fmtPct(trough)}** at its worst to **${fmtPct(peak)}** at its best — real swing size; expect drawdowns and bank into strength rather than assuming a smooth ride.`;
}

/** Trim ladder state, time stop, runner, manage engine. */
export function manageLifecycleCoaching(play: TerminalPlay, bucket: "watch" | "open" | "closed"): string | null {
  if (bucket !== "open") return null;
  const ep = play.exitPolicy;
  const parts: string[] = [];

  if (play.manageAction && play.manageAction !== "HOLD") {
    parts.push(`manage engine **${play.manageAction.replace(/_/g, " ")}**`);
  }

  // A full flatten (EXIT: time-stop/thesis-break; STOP_OUT: the hard capital-preservation stop)
  // closes the WHOLE remaining position now, superseding any partial-scale-out mechanics. Showing
  // "next trim at +100%" or "50% runner after trims" alongside "manage engine EXIT" reads as two
  // contradictory plans in one bullet -- live repro: NRG:34, 2026-09-14, manage engine EXIT
  // (time_stop) rendered right next to "next trim at +100% ... 50% runner after trims", as if a
  // future scale-out were still the plan. EXIT_RUNNER is NOT included here: it means the trims
  // already fired and only the runner remains, so "all trims banked -- runner only" (below) is
  // exactly the state that led to that recommendation, not a contradiction of it.
  const isFullFlatten = play.manageAction === "EXIT" || play.manageAction === "STOP_OUT";

  if (!isFullFlatten && ep?.trim_levels?.length) {
    const fired = ep.trim_levels.filter((t) => t.fired).length;
    const total = ep.trim_levels.length;
    const ladder = ep.trim_levels.map((t) => `+${t.trigger_pct}%${t.fired ? " ✓" : ""}`).join(" · ");
    if (fired > 0 && fired < total) {
      parts.push(`**${fired}/${total} trims banked** — ${ladder}`);
    } else if (fired === total) {
      parts.push(`**all trims banked** — runner only`);
    } else {
      const next = ep.trim_levels.find((t) => !t.fired);
      if (next) {
        // "next trim at +X%" reads as forward-looking, but when pnlPct has already passed the
        // unfired trigger (a HOLD/TAKE_PARTIAL play sitting well past its own first rail — same
        // root cause as actionNarrative's sibling bullet in play-brief-narrative.ts, live repro
        // CG SWING:CG:25, 2026-09-14, pnlPct +169.2% vs trigger 100) it is not "next", it is
        // already cleared and simply not yet banked. Checked directly against live pnlPct rather
        // than assumed from manageAction, since this branch also fires for a plain HOLD where the
        // trigger genuinely hasn't been reached yet and "next" is the correct, honest framing.
        const alreadyCrossed = typeof play.pnlPct === "number" && play.pnlPct >= next.trigger_pct;
        // A single-rung ladder (`total === 1`, the common case — most swing plays carry exactly
        // one trim trigger) makes the parenthetical `(${ladder})` byte-for-byte redundant with the
        // trigger_pct already stated in the clause itself — live repro (forensic batch 10,
        // 2026-09-14, AMLX/NEO/HACK/MSTX/PZZA): "next trim at **+100%** (+100%)" states the same
        // number twice with nothing new in the parens. The ladder recap earns its place only once
        // there's a REAL second rail to show (total > 1) — an unfired ladder's own trigger list
        // then differs from the single "next" figure, e.g. two-rung "+50% · +100%" beside "next
        // trim at +50%".
        const ladderSuffix = total > 1 ? ` (${ladder})` : "";
        // GAP FOUND (2026-09-18, Ask Largo standing mandate): `next.premium` — the ABSOLUTE
        // per-contract dollar level this rung fires at — is computed by `buildTerminalExitLadder`
        // (terminal-ladder.ts) for EVERY trim_levels entry, fired or not, and is already read for
        // the FIRED rungs (play-brief.ts's "Banked" line cites it). The unfired NEXT rung's own
        // dollar level was discarded here — only the percent-from-entry `trigger_pct` was shown,
        // never how close the position's LIVE mark actually is to that level right now. A member
        // sitting on a partial gain (mark already above entry) sees "next trim at +100%" with no
        // way to tell whether that's 60 points away or 3 — the trigger_pct alone answers "how far
        // from entry", not "how far from here". `distanceSuffix` closes that gap: prints the dollar
        // trigger plus the live % move still needed FROM THE CURRENT MARK (never fabricated when
        // either input is unusable — `next.premium` is null with no entry basis to price it off,
        // per terminal-ladder.ts's own doc comment, and `play.mark` can be genuinely unsynced).
        // Only rendered on the not-yet-crossed branch — once `alreadyCrossed` is true the "distance"
        // is negative/moot and the existing "already cleared" framing already covers it.
        //
        // BASIS MISMATCH (2026-09-18, Ask Largo standing mandate, live repro AAPL SWING:AAPL:38
        // OPEN brief): this distance was computed from `play.mark` (the mid) unconditionally, while
        // the sibling "Premium target rail" room% — play-brief-intel.ts's own live-room% line,
        // shipped the day before this one (#5173) — prefers `play.execMark` (the live tradable bid)
        // whenever it's known, the same conservative-basis discipline the premium-stop cushion also
        // follows. Both lines describe distance to the SAME dollar level: for the common single-rung
        // ladder, `next.premium` (this rung's absolute trigger) IS `exitPolicy.target_premium` (they
        // are both "the level where the position doubles"). Live repro, same brief, same instant:
        // this bullet read "mark **$5.83**, needs **$11.30** (+94% from here)" while "What to watch"
        // read "**102%** move still needed from current bid" for the identical $11.30 target — an
        // 8pp gap with no basis label to explain it, because this bullet always said "mark" even
        // when a cheaper, more conservative bid was available. Mirrors play-brief-intel.ts's
        // `targetBasis`/`targetBasisIsExec` pattern exactly rather than reinventing it, so the two
        // "how far to the next dollar level" numbers in one brief can no longer disagree.
        const distanceBasis = play.execMark != null && play.execMark > 0 ? play.execMark : play.mark;
        const distanceBasisIsExec = play.execMark != null && play.execMark > 0;
        const distanceSuffix =
          !alreadyCrossed &&
          next.premium != null &&
          typeof distanceBasis === "number" &&
          Number.isFinite(distanceBasis) &&
          distanceBasis > 0
            ? ` — ${distanceBasisIsExec ? "bid" : "mark"} **${fmtOptionUsd(distanceBasis)}**, needs **${fmtOptionUsd(next.premium)}** (+${(
                ((next.premium - distanceBasis) / distanceBasis) *
                100
              ).toFixed(0)}% from here)`
            : "";
        parts.push(
          alreadyCrossed
            ? `**+${next.trigger_pct}%** rail already cleared, not yet banked${ladderSuffix}`
            : `next trim at **+${next.trigger_pct}%**${ladderSuffix}${distanceSuffix}`,
        );
      }
    }
  }

  if (ep?.time_stop_et) {
    parts.push(`session exit **${ep.time_stop_et} ET**`);
  }

  if (!isFullFlatten && ep?.runner_fraction != null && ep.runner_fraction > 0) {
    parts.push(`**${Math.round(ep.runner_fraction * 100)}% runner** after trims`);
  }

  const dteMatch = play.contract.match(/(\d+)DTE/);
  if (dteMatch) {
    const dte = Number(dteMatch[1]);
    if (dte <= 7) parts.push(`**${dte} DTE** — theta accelerating; don't over-hold`);
    // Runway context for DTE > 7 too — play-brief-intel.ts's holdPlanSection carries the same
    // fact unconditionally as "Contract runway", but collapseRedundantIntelSections drops that
    // whole section whenever this narrative is present, on the claim its content is "folded into
    // Trade manager read above". That claim was only true for dte<=7 — above it, the DTE runway
    // fact was silently deleted with nothing standing in for it (found live on a 9DTE CRWD brief).
    else parts.push(`**${dte} DTE** remaining`);
  }

  if (!parts.length) return null;
  return `**Manage plan** — ${parts.join(" · ")}.`;
}

/** WATCH gate unblock path with reasons, not just codes. */
export function watchGateCoaching(play: TerminalPlay): string | null {
  if (!play.gateBlocks?.length) return null;
  const gates = play.gateBlocks
    .slice(0, 3)
    .map((g) => {
      const unlock = g.unlock_et ? ` (clears ~${g.unlock_et} ET)` : "";
      return `**${g.code}**: ${g.reason}${unlock}`;
    })
    .join(" · ");
  // BUG FIX (2026-09-12): every `reason` string in entry-verdict.ts's gate-block map already ends
  // with its own period (e.g. "Cortex preflight vetoed this setup — desk will not open."), so
  // unconditionally appending another "." here produced a doubled ".." on the last gate whenever
  // it has no `unlock_et` — live repro: ORCL WATCH brief 2026-09-12, "...desk will not open..".
  // Only add the closing period when `gates` doesn't already end in terminal punctuation, so a
  // future reason string without one still gets sentence-closed correctly.
  const punctuated = /[.!?]$/.test(gates) ? gates : `${gates}.`;
  // BUG FIX (Ask Largo standing mandate, 2026-09-14): "Gates blocking entry" (an "unblock path,"
  // per this function's own header) implies clearing the gate opens entry — false once the play
  // is already past its entry deadline or invalidated, since entry-enterability.ts's own if-chain
  // checks those FIRST and independently blocks entry either way. Same shared check
  // `watchEntrySection` (play-brief.ts) now uses for its own "Gates blocking entry:" header.
  const dead = deadPlayReason(play);
  return dead ? `**Also gate-blocked** (moot — ${dead}) — ${punctuated}` : `**Gates blocking entry** — ${punctuated}`;
}

/** Gamma magnet pin gravity. */
export function magnetCoaching(
  ctx: SwingPlayBriefContext,
  vec: VectorFullState | null,
  spot: number,
): string | null {
  if (vectorSnapshotStale(vec, Date.now(), ctx.sessionDate)) return null;
  const m = vec?.magnet;
  if (!m?.strike) return null;
  const lead = m.pull === "at" ? "pinned at" : `pull **${m.pull}** toward`;
  const near = Math.abs(m.distancePct) < 1.2;
  const posture = resolveGammaPosture(ctx, vec);
  // BUG FIX (2026-09-20, Ask Largo standing mandate): resolveGammaPosture is a real FOUR-value
  // regime — "long"/"short"/"transition"/"unknown" — and "transition" (verdict.ts: spot within
  // 0.1% of the gamma flip) is a genuinely RESOLVED posture, not an absence. dealerPostureLine
  // (play-brief-narrative.ts, "sitting at gamma flip — regime can flip fast") and
  // chartTechnicalsSection (play-brief-intel.ts, "Dealer gamma regime: transition (near flip)")
  // already branch on it as its own third state; this bullet only checked `posture === "long"`
  // and silently collapsed short/transition/unknown into the same generic acceleration-risk
  // framing, understating that the regime is specifically unsettled right now, not just "not long".
  const pin = near
    ? "You're sitting on the magnet — expect chop; trim into extensions, don't chase breakouts."
    : posture === "long"
      ? "Dealer hedging center of mass — price gravitates here in long-gamma regimes."
      : posture === "transition"
        ? "Dealers sitting at the gamma flip here — this node's pull is unsettled until the regime resolves."
        : "Pivot node — acceleration risk if the magnet fails to hold.";
  return `**Gamma magnet ${m.strike.toFixed(2)}** (${fmtPct(m.distancePct)} from spot) — ${lead} this node. ${pin}`;
}

/** Options-implied move envelope — don't chase outside bands. */
export function expectedMoveCoaching(
  vec: VectorFullState | null,
  spot: number,
  sessionDate?: string | null,
): string | null {
  if (vectorSnapshotStale(vec, Date.now(), sessionDate)) return null;
  const em = vec?.expectedMove;
  const b1 = em?.bands?.find((b) => b.sigma === 1);
  if (!b1) return null;
  const inside = spot >= b1.low && spot <= b1.high;
  const stretch =
    playDirectionHint(spot, b1.high) === "above"
      ? "near upper 1σ — trim longs into strength"
      : playDirectionHint(spot, b1.low) === "below"
        ? "near lower 1σ — watch for bounce or breakdown"
        : "mid-band — room to run inside envelope";
  // BUG FOUND (Ask Largo standing mandate, 2026-09-18, live repro ABTC $10.15 brief): a real
  // sub-0.05pt half-width (common on lower-priced tickers, where the 1σ band is narrow in dollar
  // terms) rounded to "±0.0 pts" via a plain toFixed(1) — reading as "no expected move" when a
  // real, nonzero band still exists. See format-nonzero.ts's own doc comment for the general shape
  // of this bug (also fixed at play-brief.ts's net-GEX line the same pass).
  return (
    `**Expected move 1σ** — **${b1.low.toFixed(2)}–${b1.high.toFixed(2)}** (±${formatFixedNonZero(b1.movePts, 1)} pts). ` +
    `${inside ? "Inside band" : "Outside band"} — ${stretch}.`
  );
}

function playDirectionHint(spot: number, level: number): "above" | "below" | "at" {
  if (Math.abs(spot - level) < 0.05) return "at";
  return spot > level ? "above" : "below";
}

/** Highest-score multi-signal confluence node. */
export function confluenceCoaching(
  vec: VectorFullState | null,
  play: TerminalPlay,
  spot: number,
  sessionDate?: string | null,
): string | null {
  if (vectorSnapshotStale(vec, Date.now(), sessionDate)) return null;
  const zones = vec?.confluenceZones ?? [];
  if (!zones.length) return null;
  const top = [...zones].sort((a, b) => (b.score ?? 0) - (a.score ?? 0))[0];
  if (!top?.center) return null;
  // BUG FIX (2026-09-14, Ask Largo standing mandate, live repro NAIL/IONX): this used to join
  // `top.kinds` bare, sharing the exact "call-wall"/"put-wall" name with the single top-ranked
  // wall this same brief shows in "Levels on chart" even when the confluence engine picked a
  // LOWER-ranked wall at a materially different price — live repro IONX showed "Confluence 22.00
  // (call-wall + max-pain, score 5.0)" here while "Call wall (GEX): 24.00" sat elsewhere in the
  // SAME brief. `vectorSnapshotStale` above already guarantees `vec` is fresh, so its own
  // top-ranked wall (`gexWalls.callWalls[0]`/`putWalls[0]`) IS the same "primary" wall the rest of
  // this fresh brief renders — no GEX-matrix fallback needed here, unlike `preferredGexWalls`
  // (play-brief-intel.ts), which also handles a stale-Vector case this function already excludes.
  // See `confluenceZoneKindsLabel`'s own doc comment (play-brief-absence.ts) for the full history.
  const primaryCallWall = vec?.gexWalls?.callWalls?.[0]?.strike ?? null;
  const primaryPutWall = vec?.gexWalls?.putWalls?.[0]?.strike ?? null;
  const kinds = top.kinds?.length
    ? confluenceZoneKindsLabel(top, { callWall: primaryCallWall, putWall: primaryPutWall }).replace(/\+/g, " + ")
    : "multi-signal";
  const dist = ((top.center - spot) / spot) * 100;
  const side = top.center < spot ? "support below" : "resistance above";
  const action =
    play.direction === "LONG"
      ? top.center < spot
        ? "dip-buy zone if thesis intact"
        : "trim zone if rejected"
      : top.center > spot
        ? "fade rallies into this node"
        : "cover if reclaimed";
  return (
    `**Confluence ${top.center.toFixed(2)}** (${kinds}, score ${top.score != null ? top.score.toFixed(1) : "—"}) — ${fmtPct(dist)} ${side}. ${action}.`
  );
}

/** Wall integrity — thin walls break easier. */
export function wallIntegrityCoaching(
  vec: VectorFullState | null,
  play: TerminalPlay,
  sessionDate?: string | null,
): string | null {
  if (vectorSnapshotStale(vec, Date.now(), sessionDate)) return null;
  const wi = vec?.wallIntegrity;
  if (!wi) return null;
  const call = wi.call?.tier;
  const put = wi.put?.tier;
  if (!call && !put) return null;

  if (play.direction === "LONG" && call === "thin") {
    return `**Call wall integrity thin** — upside cap may break easier; don't assume rejection at the wall.`;
  }
  if (play.direction === "SHORT" && put === "thin") {
    return `**Put wall integrity thin** — support may fail fast; cover if floor gives way.`;
  }
  if (call === "firm" || put === "firm") {
    const side = call === "firm" ? "call" : "put";
    return `**${side} wall firm** — expect solid rejection; respect the node on extensions.`;
  }
  return null;
}

/** Vector desk play thesis / invalidation alignment.
 *  `conflictAlreadyNoted` — crossDeskCoaching (this same file) independently derives the identical
 *  misalignment (vp.bias vs play.direction) from the identical vec.play input and, when it fires,
 *  already names this exact headline in its "Cross-desk friction" bullet (its `conflict("Vector",
 *  \`bearish (${vp.headline})\`, ...)` call quotes `vp.headline` verbatim).
 *  BUG FIXED 2026-09-13 (Ask Largo standing mandate, live AAPL brief repro): the 2026-09-09 fix
 *  for this exact duplication only dropped the trailing "— cross-check Vector thesis vs swing
 *  direction" clause below and left `vp.headline` itself in the `parts` array unconditionally —
 *  so the "Cross-desk friction" bullet and this "Vector desk:" bullet still both rendered the
 *  identical headline text ("POSITION · momentum short on continuation → target 1σ 327.77")
 *  as two separate facts in the same document. The doc comment here even claimed the headline was
 *  "non-duplicative content" while the very same paragraph described crossDeskCoaching quoting
 *  "this exact headline" — a direct self-contradiction that the tests then codified as intended
 *  behavior (`assert.match(line!, /Fade into wall/)` with `conflictAlreadyNoted=true`). Now the
 *  headline itself is also dropped when the flag is set; invalidation and starred level (which
 *  crossDeskCoaching never surfaces) are unaffected and still render. */
export function vectorPlayCoaching(
  vec: VectorFullState | null,
  play: TerminalPlay,
  sessionDate?: string | null,
  conflictAlreadyNoted?: boolean,
): string | null {
  const vp = vec?.play;
  if (!vp?.headline && !vp?.invalidation) return null;
  // Largo C2 — stale Vector desk must not coach thesis/invalidation (same gate as technicalsCoaching #4400).
  if (vectorSnapshotStale(vec, Date.now(), sessionDate)) return null;

  // BUG FIX (2026-09-15, Ask Largo standing mandate, live repro TDOC/ASAN): `vp.bias` is a
  // four-value enum (`VectorPlayBias`, vector-play-engine.ts) — "long" | "short" | "range" |
  // "neutral" — not just the two directional values this function used to check. The old `aligned`
  // test only recognized "long"/"short" as a match; anything else (including an explicit "range"/
  // "neutral" — Vector genuinely declining to take a position) fell into the SAME `!aligned` branch
  // as a real directional conflict. Live: TDOC/ASAN's headline read "POSITION · stand aside — no
  // clean edge" (bias "neutral"/"range"), yet the brief still appended "— cross-check Vector thesis
  // vs swing direction" right after it — a trader reasonably reads that as Vector disagreeing, when
  // Vector explicitly declined to take a position at all. Only fire the conflict-phrased suffix when
  // Vector's own bias is genuinely directional and doesn't match; a non-directional bias earns
  // neither the "aligned" nor the "cross-check" framing, since neither claim is true of "no opinion".
  const biasIsDirectional = vp.bias === "long" || vp.bias === "short";
  const aligned =
    (play.direction === "LONG" && vp.bias === "long") ||
    (play.direction === "SHORT" && vp.bias === "short");

  const parts: string[] = [];
  if (vp.headline && !conflictAlreadyNoted) parts.push(`**${vp.headline}**`);
  if (vp.invalidation) parts.push(`invalidation **${vp.invalidation}**`);
  // `starred[0]` is documented (VectorPlayEmit.starred, vector-play-engine.ts) to ALWAYS be the
  // headline itself — skip it here since the headline is already rendered above; showing it again
  // under "starred level" duplicated the exact same text verbatim (live repro: NRG brief 2026-09-08).
  const nextStarred = vp.starred?.slice(1)?.find(Boolean);
  if (nextStarred) parts.push(`starred level **${nextStarred}**`);

  // Nothing left to say once the headline is the only content and it's already been noted
  // elsewhere — a bare "Vector desk:" label with no facts after it is worse than no bullet.
  if (!parts.length) return null;

  let line = `Vector desk: ${parts.join(" · ")}`;
  if (!aligned && biasIsDirectional && vp.thesis && !conflictAlreadyNoted) {
    line += " — **cross-check** Vector thesis vs swing direction.";
  } else if (aligned) {
    line += " — **aligned** with swing lane.";
  }
  return line;
}

/**
 * Cross-desk conflicts are not all the same KIND of disagreement — each desk reads a different
 * evidence base on a different clock, and that difference is exactly what should drive how much
 * weight a trader gives it, not just whether it exists. Four kinds show up here:
 *  - "structure"       — Vector's live price-structure/momentum read, same session, same tape.
 *  - "flow"             — HELIX's same-session options order flow (can front-run OR lag price).
 *  - "intraday_scalp"   — 0DTE's own hours-long same-day clock — a genuinely different holding
 *                          period than a multi-day swing, so a 0DTE disagreement is often just
 *                          noise for this thesis, not evidence against it.
 *  - "digest"           — Night Hawk LEGACY's overnight next-day digest (nighthawk_recent reads
 *                          nighthawk_play_outcomes — see play-brief-absence.ts's own note on why
 *                          this is Legacy, not this board) — the least live of the four.
 */
type CrossDeskEvidenceKind = "structure" | "flow" | "intraday_scalp" | "digest";

interface CrossDeskConflict {
  /** Kept short and stable — concatenated as `${desk} ${claim}` below to reproduce the exact
   *  "Vector bearish"/"Vector bullish" substring play-brief-narrative.ts's own
   *  `counterThesisLine` dedup (`vectorConflictAlreadyNoted`) and this file's `vectorPlayCoaching`
   *  flag both detect by reading this bullet's RENDERED TEXT (see their doc comments) — changing
   *  this format would silently break that de-dup and reintroduce the 2026-09-09 triple-restated
   *  bug (docs/audit/findings-staging/2026-09-09-swing-narrative-vector-conflict-triple-restated.md). */
  desk: string;
  /** e.g. "bearish (Fade the rip)", "short (score 78)", "put-led". */
  claim: string;
  evidenceKind: CrossDeskEvidenceKind;
  weight: number;
}

/** Which evidence kind a swing archetype's OWN thesis leans on hardest, per each archetype's
 *  `note` in taxonomy.ts's `ARCHETYPE_META` (the single source of truth for what leads each
 *  archetype's score). EVENT_DRIVEN is deliberately omitted: none of the four desks read the
 *  catalyst itself, so no desk earns an archetype-specific bump for it — pure evidence-directness
 *  ordering applies instead (see CROSS_DESK_BASE_WEIGHT). */
const ARCHETYPE_LEAD_EVIDENCE: Partial<Record<SwingArchetype, CrossDeskEvidenceKind>> = {
  BREAKOUT: "structure", // "structure + relative strength lead"
  PULLBACK_CONTINUATION: "structure", // "trend structure + entry geometry lead"
  MEAN_REVERSION: "structure", // lowest-conviction lane, but still a momentum/structure read
  FAILED_BREAKDOWN: "structure", // "structure + volume confirmation lead"
  POST_EARNINGS_DRIFT: "structure", // "continuation structure" leads once the catalyst has fired
  FLOW_ACCUMULATION: "flow", // "flow persistence + strike concentration lead"
  SECTOR_ROTATION: "structure", // industry-group RS is itself a relative-price/structure read
};

/** Base load-bearing weight by evidence directness — live price structure the swing itself trades
 *  outranks same-session flow (can front-run or lag), which outranks the two slowest/mismatched
 *  reads (a same-day 0DTE clock and an overnight digest, tied). Archetype match adds a bump on
 *  top (see crossDeskWeight). */
const CROSS_DESK_BASE_WEIGHT: Record<CrossDeskEvidenceKind, number> = {
  structure: 3,
  flow: 2,
  intraday_scalp: 1,
  digest: 1,
};
const CROSS_DESK_ARCHETYPE_BONUS = 2;

function crossDeskWeight(evidenceKind: CrossDeskEvidenceKind, archetype: SwingArchetype | null): number {
  const bonus = archetype != null && ARCHETYPE_LEAD_EVIDENCE[archetype] === evidenceKind ? CROSS_DESK_ARCHETYPE_BONUS : 0;
  return CROSS_DESK_BASE_WEIGHT[evidenceKind] + bonus;
}

/** What this desk actually measures, in plain trade-manager language — the SOURCE of the
 *  disagreement, not just its existence. */
function crossDeskBasis(kind: CrossDeskEvidenceKind): string {
  switch (kind) {
    case "structure":
      return "live price structure — the same tape this swing itself trades";
    case "flow":
      return "same-session options order flow, not price structure";
    case "intraday_scalp":
      return "an hours-long 0DTE clock, not this swing's multi-day one";
    case "digest":
      return "last night's overnight next-day digest, not a live read";
  }
}

/** What would actually resolve THIS kind of disagreement — printed once, for the most
 *  load-bearing conflict only, so the coaching ends on one concrete next-check instead of N. */
function crossDeskResolution(kind: CrossDeskEvidenceKind): string {
  switch (kind) {
    case "structure":
      return "watch for it to flip back before your next trim rail — until then, size down";
    case "flow":
      return "one session's premium tilt isn't a structural change yet — give it another session before treating this as thesis-invalidating";
    case "intraday_scalp":
      return "treat it as tape noise unless it's flagging a same-day reversal right at your entry — it isn't reading the same multi-day setup you are";
    case "digest":
      return "treat it as a secondary sanity check, not a live override";
  }
}

/** Compose the ranked, reasoned cross-desk narrative — WHY the disagreement exists (evidence
 *  kind/timeframe), WHICH conflicting read is most load-bearing for this setup's archetype, and
 *  what would actually resolve it. Replaces a flat `conflicts.join(" · ")` + one fixed generic
 *  closing line with a real weighing, so two different conflict sources produce two differently
 *  reasoned readings rather than the same template with names swapped in. */
function renderCrossDeskConflict(conflicts: CrossDeskConflict[], archetype: SwingArchetype | null): string {
  const ranked = [...conflicts].sort((a, b) => b.weight - a.weight);
  const lead = ranked[0]!;
  const rest = ranked.slice(1);

  const archetypeMeta = archetype != null ? ARCHETYPE_META[archetype] : undefined;
  const leadMatchesArchetype = archetypeMeta != null && ARCHETYPE_LEAD_EVIDENCE[archetype!] === lead.evidenceKind;
  // "the most load-bearing disagreement here" is honest whether this is the only conflict (ranked
  // #1 of 1) or the top of several — unlike claiming it's "the most direct read of the four" by
  // default, which would be FALSE for a solo 0DTE/digest conflict (the two lowest-weight kinds):
  // those are the least direct reads on the board, not the most, and a lone conflict from either
  // must not borrow Vector/HELIX's directness by default phrasing.
  const leadReason = leadMatchesArchetype
    ? `exactly the evidence a **${archetypeMeta!.label}** setup leans on`
    : "the most load-bearing disagreement here";
  // Only a MULTI-conflict actually has something to rank against — a solo conflict has nothing to
  // be "heaviest" relative to, so that framing is reserved for when `rest` is non-empty.
  const weighClause = rest.length ? ", so weight it heaviest" : "";

  let text =
    `**Cross-desk friction** — ${lead.desk} ${lead.claim}. That's ${crossDeskBasis(lead.evidenceKind)} — ` +
    `${leadReason}${weighClause}: ${crossDeskResolution(lead.evidenceKind)}.`;

  if (rest.length) {
    const shown = rest.slice(0, 2);
    const clauses = shown.map(
      (c) => `${c.desk} also reads ${c.claim} (${crossDeskBasis(c.evidenceKind)}) — lighter weight here`,
    );
    text += ` ${clauses.join("; ")}.`;
    // Only 4 desks are ever checked (Night Hawk, 0DTE, Vector, HELIX), so the ONLY way to exceed
    // lead+2 shown is all 4 conflicting at once (1 lead + 3 rest) — the sole case this drops.
    // BUG FOUND 2026-09-19 (Ask Largo standing mandate): before this fix, that 4th conflicting
    // desk simply vanished from the rendered text with no trace at all — not "reconciled", just
    // gone, which is exactly the absence-as-fact violation the Largo product contract's
    // disagreement principle exists to prevent ("disagreement is represented, never reconciled by
    // the lanes themselves"). A member reading the brief would see 3 desks disagreeing and have no
    // way to know a 4th did too. Disclose the count rather than dropping it silently.
    const omitted = rest.length - shown.length;
    if (omitted > 0) {
      text += ` (+${omitted} more desk${omitted > 1 ? "s" : ""} also disagree — not detailed here.)`;
    }
  }

  return text;
}

/** Night Hawk + 0DTE + HELIX + Vector friction detection. */
export function crossDeskCoaching(ctx: SwingPlayBriefContext, play: TerminalPlay): string | null {
  const eco = ctx.ecosystem;
  const nh = nighthawkLiveForSession(eco?.nighthawk_recent, ctx.sessionDate);
  const z = zerodteLiveForSession(eco?.zerodte_today, ctx.sessionDate);
  const flow = eco ? trustedHelixFlow(eco) : null;

  const nhLong = nh?.direction?.toLowerCase() === "long";
  const nhShort = nh?.direction?.toLowerCase() === "short";
  // A committed iron CONDOR's `direction` column is nominal provenance only (the fade side of the
  // pin it came from) -- the structure itself is delta-neutral, so treating it as a directional
  // 0DTE call would fabricate a signal the desk never took. #4788 fixed the identical mislabel in
  // flowIntelSection's own "0DTE desk" line (play-brief-intel.ts) but missed this second call site
  // reading the same zerodte_today.direction field -- gate both alignment and conflict detection
  // here on !is_condor too, or a condor fade can silently render as "Cross-desk friction" or
  // "Desk alignment" against the swing's real directional call.
  const zLong = z?.direction === "long" && z?.is_condor !== true;
  const zShort = z?.direction === "short" && z?.is_condor !== true;
  const callHeavy = flow && flow.call_premium > flow.put_premium * 1.3;
  const putHeavy = flow && flow.put_premium > flow.call_premium * 1.3;

  const vec = vectorOf(ctx);
  const vp = vec?.play;
  const vectorLive = !vectorSnapshotStale(vec, Date.now(), ctx.sessionDate);
  const vLong = vectorLive && vp?.bias === "long";
  const vShort = vectorLive && vp?.bias === "short";

  const archetype = (play.archetype ?? null) as SwingArchetype | null;
  const conflicts: CrossDeskConflict[] = [];
  const conflict = (desk: string, claim: string, evidenceKind: CrossDeskEvidenceKind) => {
    conflicts.push({ desk, claim, evidenceKind, weight: crossDeskWeight(evidenceKind, archetype) });
  };
  if (play.direction === "LONG" && nhShort) {
    conflict("Night Hawk", `bearish${nh?.conviction ? ` (${nh.conviction})` : ""}`, "digest");
  }
  if (play.direction === "SHORT" && nhLong) {
    conflict("Night Hawk", `bullish${nh?.conviction ? ` (${nh.conviction})` : ""}`, "digest");
  }
  if (play.direction === "LONG" && zShort) conflict("0DTE", `short (score ${z?.score ?? "—"})`, "intraday_scalp");
  if (play.direction === "SHORT" && zLong) conflict("0DTE", `long (score ${z?.score ?? "—"})`, "intraday_scalp");
  if (play.direction === "LONG" && vShort) {
    conflict("Vector", `bearish (${vp?.headline ?? vp?.grade ?? "desk read"})`, "structure");
  }
  if (play.direction === "SHORT" && vLong) {
    conflict("Vector", `bullish (${vp?.headline ?? vp?.grade ?? "desk read"})`, "structure");
  }
  if (play.direction === "LONG" && putHeavy) conflict("HELIX", "put-led", "flow");
  if (play.direction === "SHORT" && callHeavy) conflict("HELIX", "call-led", "flow");

  if (conflicts.length) {
    return renderCrossDeskConflict(conflicts, archetype);
  }

  const aligned: string[] = [];
  if (nh && ((play.direction === "LONG" && nhLong) || (play.direction === "SHORT" && nhShort))) {
    if (nh.conviction) aligned.push(`NH ${nh.conviction}`);
  }
  if (z && ((play.direction === "LONG" && zLong) || (play.direction === "SHORT" && zShort))) {
    if (z.score != null && Number.isFinite(z.score)) aligned.push(`0DTE score ${z.score}`);
  }
  // BUG FOUND 2026-09-19 (Ask Largo standing mandate): the conflict branch above checks all FOUR
  // desks (Night Hawk, 0DTE, Vector, HELIX) via `conflict(...)`, but this alignment branch only
  // ever pushed NH/0DTE into `aligned` -- HELIX (and Vector, though Vector's own agreement already
  // gets its own dedicated line via vectorPlayCoaching's "aligned with swing lane" suffix) was
  // never even checked here. So HELIX flow disagreeing with the swing renders a "Cross-desk
  // friction" bullet (weight 2, the SECOND-highest of the four kinds this file's own
  // CROSS_DESK_BASE_WEIGHT ranks), while HELIX flow agreeing was silently dropped everywhere in
  // the brief -- a one-sided disclosure of exactly the shape the Largo product contract's
  // disagreement principle exists to prevent, just on the corroborating side instead of the
  // conflicting one. Fixed by mirroring the conflict branch's own callHeavy/putHeavy check here.
  if (flow && ((play.direction === "LONG" && callHeavy) || (play.direction === "SHORT" && putHeavy))) {
    aligned.push(`HELIX ${play.direction === "LONG" ? "call" : "put"}-led`);
  }
  if (aligned.length >= 2) {
    return `**Desk alignment** — ${aligned.join(" + ")} **support** the ${play.direction} swing.`;
  }

  return null;
}

/**
 * Resolves THIS brief's own contract expiry (YYYY-MM-DD) by matching `ctx.play` against
 * `ctx.laneRows` on ticker + entry premium — the same disambiguation key `siblingPositionsNote`
 * (play-brief.ts) uses, since `TerminalPlay.contract` is a human label string ("110C · 13DTE"),
 * not a structured `{expiry}` the earnings comparison below can read directly.
 */
function ownContractExpiry(ctx: SwingPlayBriefContext): string | null {
  const { play } = ctx;
  if (play.entry == null || !Number.isFinite(play.entry)) return null;
  const ticker = play.ticker.toUpperCase();
  const own = ctx.laneRows.find((r) => {
    if (r.ticker.toUpperCase() !== ticker) return false;
    if (r.entryPremium == null || !Number.isFinite(r.entryPremium)) return false;
    return Math.abs(r.entryPremium - play.entry!) <= 0.005;
  });
  return own?.contract?.expiry ?? null;
}

/**
 * BUG FOUND 2026-09-11 (Ask Largo standing mandate — adversarial follow-up to #4764's sibling-
 * position disclosure). This earnings warning fires purely off `days_until` (calendar days from
 * TODAY to the print) and never checked which contract the brief is actually about — a ticker-
 * level fact applied identically regardless of the covered position's own expiry. #4764 made this
 * a live, visible problem rather than a theoretical one: two concurrent positions on the same
 * ticker can have genuinely different expiries (that's the whole reason the disclosure exists),
 * and one can expire BEFORE the earnings print while its sibling expires after. Before this fix,
 * both briefs printed the identical "size down or exit before report" instruction — nonsensical
 * for the position that will already be closed/expired before the print ever lands, and correct
 * only for the other. Fix: when this brief's own contract expiry resolves and is on/before the
 * earnings date, say so explicitly (no gap exposure) instead of issuing an instruction that
 * cannot apply to this contract. Falls through to the original warning when the expiry can't be
 * resolved (matches nothing in laneRows, e.g. a closed/historical play) or genuinely sits after
 * the print — same behavior as before for the population this never affected.
 */
// BUG FIX (2026-09-14, Ask Largo standing mandate, live repro PLAY): a same-day print already
// having LANDED and already having moved the stock is a fundamentally different fact than the
// same print still being ahead — but `days_until <= 14`/`=== 0` alone can't distinguish "prints
// tonight" from "printed 3 hours ago", and the branch below kept saying "size down or exit before
// report" (forward-looking) regardless. Live repro: PLAY reported AMC 2026-09-14 16:31 ET (missed,
// -12.16% after-hours within minutes); the brief rendered at 19:07 ET — 2.5+ hours later, with the
// SAME brief's own Vector desk read already "momentum short on continuation" off the post-print
// tape — still said "Earnings in 0d (2026-09-14 (afterhours)) — size down or exit before report".
// A member reading only this bullet would think they still had time to react pre-print when the
// gap had already happened. `report_time` is a bucket ("premarket"/"afterhours"/"unknown"), not a
// clock time, so "already landed" is derived from the READ time (`ctx.asOf`) against the bucket's
// own implied bell-relative threshold (16:00 ET for afterhours, 09:30 ET for premarket) on the
// earnings date itself — "unknown" timing never claims already-landed, matching this file's
// existing honest-absence discipline (the sibling `noGapExposure` comment right below makes the
// same call for the identical reason).
function printAlreadyLandedThresholdMs(ymd: string, reportTime: string | null): number | null {
  if (reportTime === "afterhours") return parseEtStamp(etStampFromDateOrIso(ymd));
  if (reportTime === "premarket") return parseEtStamp(`${ymd} 09:30 ET`);
  return null;
}

/** Earnings + Meridian catalyst window. */
export function catalystCoaching(ctx: SwingPlayBriefContext): string | null {
  const earnings = ctx.ecosystem?.arsenal?.earnings;
  const meridian = ctx.meridian?.items?.[0];

  if (earnings?.days_until != null && earnings.days_until <= 14) {
    const timing = earnings.report_time ? ` (${earnings.report_time})` : "";
    const expiry = earnings.earnings_date ? ownContractExpiry(ctx) : null;
    // A contract expiring STRICTLY before the print date is always safe — it's settled before
    // the earnings date even exists yet. A contract expiring on the SAME day is only safe when
    // the print is confirmed after-hours (the option already settled at that day's close before
    // the print lands); a same-day PRE-MARKET print gaps the stock before the bell, and a
    // contract alive through that day's open was exposed to the gap despite expiring "on" the
    // print date. Unknown/unconfirmed timing defaults to NOT safe (the existing honest-absence
    // discipline this file follows elsewhere) rather than guessing it landed after close.
    const sameDay = expiry != null && earnings.earnings_date != null && expiry === earnings.earnings_date;
    const confirmedAfterClose = /^(after|post)/i.test(earnings.report_time ?? "");
    const noGapExposure =
      expiry != null && earnings.earnings_date != null && expiry < earnings.earnings_date
        ? true
        : sameDay && confirmedAfterClose;
    if (noGapExposure) {
      return (
        `**Earnings in ${earnings.days_until}d** (${earnings.earnings_date}${timing}) — ` +
        `this contract expires ${expiry}, on/before the print, so no earnings-gap exposure from ` +
        `this position (a concurrent sibling with a later expiry may still be exposed — check its own brief).`
      );
    }
    // BUG FIX (2026-09-15, Ask Largo standing mandate, live repro PLAY, same day as the fix that
    // introduced this line): `ctx.asOf` in REAL production is `etStamp(nowMs)`'s "YYYY-MM-DD HH:mm
    // ET" format (play-brief-context.ts:181 — the ISO fallback only fires if etStamp itself throws,
    // which it never does for a valid Date.now()), NOT an ISO-8601 string. `Date.parse` returns NaN
    // on that format — confirmed directly (`Date.parse("2026-09-14 20:36 ET")` === NaN) — so
    // `Number.isFinite(nowMs)` silently failed closed and `alreadyPrinted` could never become true
    // in production, making the fix below dead code: PLAY's real brief, read ~4h05m after its print
    // landed (well past the threshold), still showed the old "size down or exit before report"
    // text. The regression tests added with this branch all built `ctx.asOf` as an ISO literal
    // (`"2026-09-14T23:07:00.000Z"`), which `Date.parse` handles fine — a fixture shape that never
    // matched what the real context loader emits, so green tests shipped a branch that could not
    // fire on real data. `parseEtStamp` (already imported below for `printThresholdMs`) parses the
    // real "YYYY-MM-DD HH:mm ET" shape; falls back to `Date.parse` for the rare ISO-fallback case.
    const nowMs = parseEtStamp(ctx.asOf) ?? Date.parse(ctx.asOf);
    const printThresholdMs =
      earnings.days_until === 0 && earnings.earnings_date != null
        ? printAlreadyLandedThresholdMs(earnings.earnings_date, earnings.report_time)
        : null;
    const alreadyPrinted = printThresholdMs != null && Number.isFinite(nowMs) && nowMs >= printThresholdMs;
    if (alreadyPrinted) {
      return (
        `**Earnings already printed today** (${earnings.earnings_date}${timing}) — ` +
        `thesis now carries a realized print gap; reassess off the post-print structure, not the pre-print setup.`
      );
    }
    return (
      `**Earnings in ${earnings.days_until}d** (${earnings.earnings_date}${timing}) — ` +
      `size down or exit before report unless thesis is earnings-driven.`
    );
  }

  if (meridian && meridian.days_until <= 7) {
    const when =
      meridian.days_until <= 0 ? "**today**" : meridian.days_until === 1 ? "**tomorrow**" : `in **${meridian.days_until}d**`;
    const em = meridian.expected_move_pct != null ? ` · implied **${meridian.expected_move_pct.toFixed(1)}%**` : "";
    return `**Catalyst ${when}** — **${meridian.title}** (${meridian.kind}, ${meridian.impact})${em}. Vol can expand — tighten or reduce size.`;
  }

  return null;
}

/** VEX / vanna lens — second-order dealer hedging when it diverges from gamma. */
export function vexCoaching(
  vec: VectorFullState | null,
  spot: number | null,
  sessionDate?: string | null,
): string | null {
  if (!vec || vectorSnapshotStale(vec, Date.now(), sessionDate)) return null;
  const vFlip = fin(vec.vexFlip);
  const gFlip = fin(vec.gammaFlip);
  const vCall = vec.vexWalls?.callWalls?.[0]?.strike;
  const vPut = vec.vexWalls?.putWalls?.[0]?.strike;
  if (vFlip == null && vCall == null && vPut == null) return null;

  const parts: string[] = [];
  if (vFlip != null) {
    const above = spot != null ? (spot >= vFlip ? "above" : "below") : null;
    parts.push(`vanna flip **${vFlip.toFixed(2)}**${above ? ` (spot ${above})` : ""}`);
  }
  if (vCall != null) parts.push(`vanna+ wall **${vCall.toFixed(2)}**`);
  if (vPut != null) parts.push(`vanna− wall **${vPut.toFixed(2)}**`);

  let diverge = "";
  if (gFlip != null && vFlip != null && Math.abs(gFlip - vFlip) > 0.5) {
    diverge = " **γ vs vanna diverge** — vanna can accelerate moves gamma alone wouldn't predict.";
  }

  return `**VEX lens** — ${parts.join(" · ")}.${diverge} Watch vanna walls on vol-expansion days.`;
}

/** Large front-expiry flow prints from Vector — institutional tape at strike. */
export function flowPrintsCoaching(
  vec: VectorFullState | null,
  play: TerminalPlay,
  sessionDate?: string | null,
): string | null {
  if (vectorSnapshotStale(vec, Date.now(), sessionDate)) return null;
  const f = vec?.flowMarkers;
  if (!f?.available || !f.prints?.length) return null;
  const top = f.prints[0]!;
  const aligned =
    (play.direction === "LONG" && top.side?.toLowerCase() === "call") ||
    (play.direction === "SHORT" && top.side?.toLowerCase() === "put");
  const conflict =
    (play.direction === "LONG" && top.side?.toLowerCase() === "put") ||
    (play.direction === "SHORT" && top.side?.toLowerCase() === "call");
  let tail = "";
  if (aligned) tail = " **Aligns** with swing direction.";
  else if (conflict) tail = " **Conflicts** with swing — size down until tape agrees.";
  const more = f.meta.largeFound > f.prints.length ? ` (+${f.meta.largeFound - f.prints.length} more)` : "";
  return (
    `**Large print** — ${top.side} **${top.strike.toFixed(2)}** ${fmtPremium(top.premium)}` +
    `${f.expiry ? ` (${f.expiry})` : ""}${more}.${tail}`
  );
}

/** Macro rates + breadth tone — index-correlated swing context. */
export function macroTapeCoaching(ctx: SwingPlayBriefContext): string | null {
  const arsenal = ctx.ecosystem?.arsenal;
  if (!arsenal) return null;
  const parts: string[] = [];
  if (arsenal.macro) {
    const m = arsenal.macro;
    if (m.yield_10_year != null) parts.push(`10Y **${m.yield_10_year.toFixed(2)}%**`);
    if (m.curve_10y_1y_spread != null) parts.push(`curve **${m.curve_10y_1y_spread.toFixed(2)}**`);
  }
  if (arsenal.breadth?.tone) {
    parts.push(`breadth **${arsenal.breadth.tone}**`);
  }
  if (!parts.length) return null;
  const riskOff = arsenal.breadth?.tone?.toLowerCase().includes("risk-off");
  const riskOn = arsenal.breadth?.tone?.toLowerCase().includes("risk-on");
  const hint =
    ctx.play.direction === "LONG" && riskOff
      ? "Risk-off tape — long swings need tighter stops."
      : ctx.play.direction === "SHORT" && riskOn
        ? "Risk-on tape — shorts face headwind; respect call walls."
        : "Macro context for sizing — not a swing entry trigger alone.";
  return `**Macro tape** — ${parts.join(" · ")}. ${hint}`;
}

/** Executable vs mid P&L honesty — slippage on the tape. */
export function execSlippageCoaching(play: TerminalPlay): string | null {
  const mid = fin(play.pnlPct);
  const exec = fin(play.execPnlPct);
  if (mid == null || exec == null) return null;
  const gap = mid - exec;
  if (Math.abs(gap) < 5) return null;
  return (
    `**Executable P&L** — mid **${fmtPct(mid)}** vs fill **${fmtPct(exec)}** ` +
    `(**${gap > 0 ? "-" : "+"}${Math.abs(gap).toFixed(0)}%** slippage). Size exits on the bid, not the mark.`
  );
}

/** Short interest / days-to-cover — squeeze fuel context. */
export function shortInterestCoaching(ctx: SwingPlayBriefContext, play: TerminalPlay): string | null {
  const fund = ctx.ecosystem?.arsenal?.fundamentals;
  if (!fund?.days_to_cover) return null;
  if (fundamentalsAncient(fund.as_of, Date.now())) return null;
  const dtc = fund.days_to_cover;
  if (dtc < 3) return null;
  if (play.direction === "LONG" && dtc >= 5) {
    return `**Short interest** — **${dtc.toFixed(1)} DTC** · elevated cover risk can fuel squeezes; respect call walls on extensions.`;
  }
  if (play.direction === "SHORT" && dtc >= 8) {
    return `**Crowded short** — **${dtc.toFixed(1)} DTC** · squeeze risk elevated; tighten stops and avoid chasing breakdowns.`;
  }
  return null;
}

/** IV rank — vol expansion / contraction context. */
export function ivRankCoaching(play: TerminalPlay): string | null {
  const iv = fin(play.ivRank);
  if (iv == null) return null;
  if (iv >= 70) {
    return `**IV rank ${Math.round(iv)}** — vol elevated; trims into strength matter — theta + crush risk on hold.`;
  }
  if (iv <= 25) {
    return `**IV rank ${Math.round(iv)}** — vol cheap; upside needs underlying move, not vol expansion alone.`;
  }
  return null;
}

/** Recent wall dynamics — last 2 bead events for live structure shifts. */
export function wallDynamicsCoaching(
  vec: VectorFullState | null,
  sessionDate?: string | null,
): string | null {
  if (vectorSnapshotStale(vec, Date.now(), sessionDate)) return null;
  const events = vec?.wallEvents ?? [];
  if (events.length < 2) return null;
  const recent = events.slice(-2);
  const lines = recent.map((w) => `${w.kind.replace(/_/g, " ")}: ${w.message}`).join(" · ");
  return `**Wall dynamics** — ${lines}. Structure shifting — re-check break levels.`;
}

export function laneRankCoaching(play: TerminalPlay, laneRows: SwingPlayBriefContext["laneRows"]): string | null {
  const snap = computeLaneRank(play, laneRows);
  if (!snap || snap.total < 2) return null;
  // A broken thesis (own setupState INVALIDATED) never gets a "leader"/"top-tier" praise line —
  // the same brief's Entry/Verdict sections already say the thesis broke; every branch below reads
  // as encouragement, which would directly contradict that disclosure (live repro 2026-09-12: SKHY
  // sat #1 of 8 on WATCH by raw score with its own thesis invalidated pre-entry).
  if (snap.selfInvalidated) return null;

  const label = snap.bucket === "open" ? "OPEN" : "WATCH";
  // Live repro 2026-09-12 (same cycle #4849 was opened): CRWD sat #1 of 90 on OPEN by raw score
  // (87) while its own manage engine was EXIT_RUNNER (round-tripped +130% peak -> -10%, all trims
  // banked, runner only) -- the brief's very first bullet said "Desk says TRIM ... consider
  // protecting what's left," then three lines later this branch still said "Lane leader ... Desk
  // attention follows the top row." #4842 only guarded this branch on selfInvalidated (setupState);
  // it never covered a rank-1 play whose own manageAction says reduce -- the exact peer-exclusion
  // gap #4842's own EXITING_MANAGE_ACTIONS closed for OTHER tickers' named-leader pointer, just not
  // for THIS play's self-referential rank-1 claim. selfReducing (added earlier this same PR for the
  // below-median branch) closes it here too.
  if (snap.rank === 1 && !snap.selfReducing) {
    return `**Lane leader** — **#1 of ${snap.total}** on ${label} (score **${snap.playScore}**). Desk attention follows the top row.`;
  }
  if (snap.deltaFromMedian < -15 && snap.selfReducing) {
    // Live repro 2026-09-12: CG sat #90/90 by raw entry-time score — a real +169.2%/+134.6% exec
    // winner already on TRIM — and this exact bullet still said "confirm before adding size" three
    // lines after "Desk says TRIM ... Bank partial into strength." The entry-time score standing is
    // real context, but "adding size" is backwards advice once the position's own plan is to reduce.
    return (
      `**Below lane median on entry-time score** — **#${snap.rank}/${snap.total}** (score **${snap.playScore}**, ` +
      `${snap.deltaFromMedian} vs median) — not a sizing signal here; this position's own plan already calls for reducing, not adding.`
    );
  }
  if (snap.deltaFromMedian < -15) {
    return (
      `**Below lane median** — **#${snap.rank}/${snap.total}** (score **${snap.playScore}**, ` +
      `${snap.deltaFromMedian} vs median). Leader: **${snap.topTicker ?? "—"}** @ **${snap.topScore ?? "—"}** — confirm before adding size.`
    );
  }
  if (snap.rank <= 3 && snap.deltaFromMedian >= 10 && !snap.selfReducing) {
    return `**Top-tier setup** — **#${snap.rank}/${snap.total}** on ${label} · **+${snap.deltaFromMedian}** vs median.`;
  }
  return null;
}

/** Chart technicals one-liner — RSI / VWAP / structure. */
export function technicalsCoaching(
  vec: VectorFullState | null,
  play: TerminalPlay,
  sessionDate?: string | null,
): string | null {
  // Largo C2 — stale Vector chart read must not coach directional alignment (#4387 class).
  if (vectorSnapshotStale(vec, Date.now(), sessionDate)) return null;
  const t = vec?.technicals;
  if (!t) return null;
  const parts: string[] = [];
  if (t.vwap != null && vec?.spot != null) {
    // BUG (found 2026-09-09 live POET repro): this used to read `above = spot >= vwap` and then
    // label `(${above ? "above" : "below"} spot)` — but `above` answers "is SPOT at/above VWAP",
    // which is the OPPOSITE fact from "is VWAP above/below spot". Spot at/above VWAP means VWAP is
    // BELOW spot, not above. Every brief therefore printed the inverse of reality: live POET had
    // spot 8.38 < vwap 8.44 (VWAP genuinely above spot) and the narrative said "(below spot)" —
    // directly contradicting the correct wording ("price below session VWAP") the separate "Chart
    // technicals" section renders two blocks away in the same brief. `technicalsBias()` below
    // (play-brief-technicals.ts) computes the bull/bear VOTE from the same `spot >= vwap` test
    // correctly — only this display label had the sense flipped.
    const vwapAtOrBelowSpot = vec.spot >= t.vwap;
    parts.push(`VWAP **${t.vwap.toFixed(2)}** (${vwapAtOrBelowSpot ? "below" : "above"} spot)`);
  }
  if (t.rsi != null) {
    const zone = t.rsi > 70 ? "overbought" : t.rsi < 30 ? "oversold" : "neutral";
    parts.push(`RSI **${Math.round(t.rsi)}** (${zone})`);
  }
  if (t.emaStack) {
    const word = t.emaStack === "up" ? "bull stack" : t.emaStack === "down" ? "bear stack" : "mixed EMAs";
    parts.push(word);
  }
  // technicalsBias() below counts this vote toward bull/bear — surface it, or a MACD dissenting
  // from the printed bias (e.g. bear MACD inside an otherwise-bullish read) is invisible here.
  if (t.macd) {
    parts.push(`MACD **${t.macd === "bull" ? "bullish" : "bearish"}**`);
  }
  if (t.structure?.type) {
    parts.push(
      `structure **${t.structure.type.replace(/_/g, " ")} ${t.structure.direction}** @ **${t.structure.level.toFixed(2)}**`,
    );
  }
  if (!parts.length) return null;

  const chartBias = technicalsBias(t, vec?.spot ?? null);
  const biasLabel =
    chartBias === "bullish"
      ? "chart reads bullish"
      : chartBias === "bearish"
        ? "chart reads bearish"
        : "mixed chart read";
  const aligned =
    (play.direction === "LONG" && chartBias === "bullish") ||
    (play.direction === "SHORT" && chartBias === "bearish");
  const conflicts =
    (play.direction === "LONG" && chartBias === "bearish") ||
    (play.direction === "SHORT" && chartBias === "bullish");
  const alignment = aligned
    ? "aligns with swing direction"
    : conflicts
      ? "conflicts with swing direction"
      : null;
  return `**Chart read** — ${parts.join(" · ")} — ${biasLabel}${alignment ? ` (${alignment})` : ""}.`;
}

/** Data honesty — stale marks, quiet HELIX, old Vector. */
export function dataHonestyCoaching(ctx: SwingPlayBriefContext, play: TerminalPlay): string | null {
  const vec = vectorOf(ctx);
  const warnings: string[] = [];

  // BUG FOUND 2026-09-20 (Ask Largo standing mandate): `collectBriefUnavailableSources`
  // (play-brief-absence.ts, PR #5264) just gained the identical guard for the identical reasoning
  // -- a WATCH play whose entry is already dead (`deadPlayReason`: thesis invalidated,
  // entry-validity deadline passed, contract expired, or extended past the valid entry window) has
  // nothing left for a live-data-freshness warning to usefully say: nothing re-scans a dead
  // candidate to ever refresh its Vector/GEX/HELIX reads, so "stale" is a permanent, uninformative
  // state for it, not a transient one worth flagging. This function reads the SAME four live-desk
  // signals (Vector age, GEX matrix age, HELIX pipeline freshness, discovery-scan session) into one
  // "Data caveat" bullet but never imported `deadPlayReason` for them -- watchGateCoaching (this
  // same file, a few lines up) and play-brief.ts's top-level Invalidation callout both already gate
  // on it; this sibling function, called from the identical WATCH-bucket path
  // (collectCoachingBullets), did not. Scoped to WATCH-status plays only (mirroring #5264's own
  // `isDeadWatch` idiom) -- OPEN/HOLD/TRIM carry the same setupState/entryStatus/watchEntryExpired
  // fields with leftover pre-entry values that must not be reinterpreted once a position is live.
  const dead =
    play.status !== "OPEN" && play.status !== "HOLD" && play.status !== "TRIM" && play.status !== "CLOSED"
      ? deadPlayReason(play)
      : null;

  const markAbsence = collectOptionMarkStalenessAbsence(play, Date.now());
  if (markAbsence) {
    if (markAbsence.reason === "sync quote without freshness timestamp") {
      // Live repro 2026-09-11 (Ask Largo standing mandate, TWST): `markIsSync` collapses two
      // different real-world cases (see play-brief.ts's own `markGenuinelyUnknown` split) — a
      // mark that is genuinely unknown (no P&L basis exists either) versus a REAL, live mark that
      // simply has no stored freshness timestamp. The Position section already tells these apart
      // and prints "(live quote, no freshness timestamp)" for the second case — but this bullet
      // used to say "mark not synced to live tape" for BOTH, which directly contradicts that own
      // "live quote" wording a few lines above it in the same brief when a real pnlPct exists.
      // `pnlPct != null` is the same signal play-brief.ts uses to prove the mark is real (a P&L
      // percentage can only be computed from a real mark), so it's reused here rather than
      // re-deriving a second, possibly-drifting definition of "real mark" in this file.
      warnings.push(
        play.pnlPct != null
          ? "mark is a live quote but lacks a freshness timestamp"
          : "mark not synced to live tape",
      );
    } else {
      const stamp = markAbsence.reason.replace(/^stale — last synced /, "");
      warnings.push(`option mark from **${stamp}** — not live-synced`);
    }
  }
  // Largo C2 (2026-09-16): this Vector check used to be a raw `dataAgeMs > 120_000` comparison —
  // same bug shape as play-brief-intel.ts's dataFreshnessSection before #5070/#5069 fixed it —
  // which missed a future-skewed Infinity dataAgeMs rendering the literal "Infinitys" and a null
  // dataAgeMs (with vec.freshness === "stale") silently never warning at all. Now gated on the
  // shared vectorAgeStale helper, matching every other staleness check in the play-brief lane.
  if (!dead && vectorAgeStale(vec, Date.now())) {
    const label = ageSecondsLabel(vec?.dataAgeMs) ?? "clock-skewed";
    warnings.push(`Vector **${label}** stale`);
  }
  const gex = ctx.ecosystem?.gex_positioning;
  if (!dead && gexMatrixStale(gex)) {
    const label = ageSecondsLabel(gexMatrixAgeMs(gex)) ?? "clock-skewed";
    warnings.push(`GEX matrix **${label}** stale — dealer posture may lag spot`);
  }
  if (!dead && ctx.ecosystem?.flow_feed_fresh === false) {
    warnings.push(
      "HELIX pipeline stale — flow read unavailable, not evidence of quiet tape",
    );
  }
  if (
    !dead &&
    ctx.scanSessionDay &&
    ctx.sessionDate &&
    ctx.scanSessionDay !== ctx.sessionDate
  ) {
    warnings.push(
      `swing discovery from **${ctx.scanSessionDay}** — today's scan not yet run`,
    );
  }

  if (!warnings.length) return null;
  return `**Data caveat** — ${warnings.join(" · ")}. Treat levels as indicative until refresh.`;
}

/** Closed play post-mortem coaching. */
export function closedCoaching(play: TerminalPlay): string | null {
  if (play.status !== "CLOSED") return null;
  const lines: string[] = [];

  if (play.peak != null && play.exitPnlPct != null) {
    const outcome = mfeCaptureOutcome(play.exitPnlPct, play.peak, play.mfeCapturePct);
    lines.push(`Exited **${fmtPct(play.exitPnlPct)}** vs peak **${fmtPct(play.peak)}**`);
    if (outcome?.kind === "round_trip") {
      // Live repro AAPL:36 (2026-09-13, Ask Largo standing mandate): a peak of only +1.3% -
      // nowhere near SWING_SCALE_OUT_POLICY's first real trim rail (+100%) - still got the
      // generic "tighten at first trim rail next time" advice, implying a trim decision was
      // missed when there was never enough room to make one. Reuses the exact same >20 threshold
      // the sibling capture branch below already established for this judgment, rather than
      // inventing a new one - below it, the miss reads as an entry-timing/thesis problem, not a
      // trim-discipline one.
      const advice = outcome.peakPct > 20
        ? "tighten at first trim rail next time."
        : "barely cleared breakeven before reversing — a trim rail wouldn't have helped here; review entry timing or thesis strength instead.";
      lines.push(`**Round-tripped past breakeven** — was up **${fmtPct(outcome.peakPct)}** at peak, closed at **${fmtPct(outcome.exitPnlPct)}**; ${advice}`);
    } else if (outcome?.kind === "capture") {
      const capture = outcome.capturePct;
      if (capture >= 75) lines.push(`**Strong discipline** — captured **${fmtPct(capture)}** of peak; replicate trim timing.`);
      else if (capture < 35 && play.peak > 20) lines.push(`**Gave back the move** — only **${fmtPct(capture)}** MFE capture; tighten at first trim rail next time.`);
      else lines.push(`MFE capture **${fmtPct(capture)}** — review runner vs trim policy.`);
    }
  }

  if (play.closedReason) {
    const r = play.closedReason.replace(/_/g, " ");
    if (play.closedReason === "thesis") lines.push(`Exit on **thesis break** — note which pillar failed first in playbook review.`);
    else if (play.closedReason === "stopped" || play.closedReason === "stop") lines.push(`**Stop fired** (${r}) — check if entry was extended past invalidation.`);
    else lines.push(`Exit reason: **${r}**`);
  }

  // GAP FOUND (2026-09-18, Ask Largo standing mandate): `play.trough` (the position's own worst
  // intra-trade excursion, `troughDisplay` — adapters.ts, computed unconditionally alongside
  // `peakDisplay` for every row with an entry+trough premium, CLOSED rows included) never reached
  // ANY section of a CLOSED brief. `troughResilienceCoaching`'s own doc comment (this same file,
  // a few lines above) explicitly claims this is a non-issue — "a CLOSED play's own 'Lessons'
  // section already covers post-mortem framing for that bucket, and this isn't meant to duplicate
  // it" — but that claim was never actually true: this function (the CLOSED bucket's real
  // "Lessons" content, via `collectCoachingBullets`) only ever cited `play.peak` (the "Exited X vs
  // peak Y" line above) and never `play.trough` anywhere. Live-verified: `pnlSection`'s own
  // 2026-09-15 comment (play-brief.ts) built the exact same trough-narration reasoning for OPEN
  // positions — "this one tested you early, don't flinch on the next drawdown scare" — reasoning
  // that applies with EVEN MORE force in a post-mortem review (did this position round-trip
  // through a real drawdown before it worked, or before it failed for good — a pattern worth
  // noting for the next similar setup) yet the data was silently dropped for exactly the bucket
  // whose whole job is teaching that lesson. Same >=40pt meaningful-swing threshold as
  // `troughResilienceCoaching` for consistency; only fires on a real negative excursion (a
  // position that never went negative has nothing to note here).
  // BUG FOUND (2026-09-18, Ask Largo standing mandate, live repro NN:32 CLOSED/stopped): the
  // `peak - trough >= 40` gate above proves the SWING from peak to trough was large, but says
  // nothing about whether trough itself differs from the exit — and for a STOPPED close, the stop
  // fires at (or within noise of) the worst mark recorded, so `trough` and `exitPnlPct` are
  // routinely near-identical. Live output was "dipped to -60.3% at its worst before closing at
  // -60.3%" — both fmtPct'd to the SAME displayed number, so the line's entire claim ("note the
  // real intra-trade swing") is false in the one case a reader would trust it most: it reads as
  // "there was a separate low point worth learning from" when the trough *was* the outcome, no
  // recovery-then-relapse ever happened. Require trough to sit meaningfully below the exit
  // (>=5pt) before claiming a swing "before" the outcome exists to report.
  if (
    typeof play.trough === "number" &&
    Number.isFinite(play.trough) &&
    play.trough < 0 &&
    typeof play.peak === "number" &&
    Number.isFinite(play.peak) &&
    play.peak - play.trough >= 40 &&
    typeof play.exitPnlPct === "number" &&
    Number.isFinite(play.exitPnlPct) &&
    play.exitPnlPct - play.trough >= 5
  ) {
    lines.push(
      `**Drawdown before outcome** — this position dipped to **${fmtPct(play.trough)}** at its worst before closing at **${fmtPct(play.exitPnlPct)}**; note the real intra-trade swing when sizing or setting stops on similar setups.`,
    );
  }

  if (!lines.length) return null;
  // Each pushed line above is its own distinct post-mortem point (outcome, MFE-capture verdict,
  // exit-reason lesson) — joining with a bare space ran up to three of them together into one
  // illegible sentence (live repro: AAPL:36, "Exited -56.2% vs peak +1.3% Round-tripped past
  // breakeven — was up +1.3% at peak, closed at -56.2%; tighten at first trim rail next time.
  // Stop fired (stopped) — check if entry was extended past invalidation." — no boundary between
  // three separate facts). collectCoachingBullets's `push()` prefixes the FIRST line with "• "
  // (it only sees closedCoaching's return as one string); joining the rest with "\n• " here
  // gives every point its own bullet, matching the OPEN/WATCH buckets' one-push-per-point pattern.
  return lines.join("\n• ");
}

/** Collect prioritized coaching bullets for narrative assembly. */
export function collectCoachingBullets(
  ctx: SwingPlayBriefContext,
  bucket: "watch" | "open" | "closed",
  spot: number | null,
): string[] {
  const { play } = ctx;
  const vec = vectorOf(ctx);
  const out: string[] = [];
  const push = (line: string | null | undefined) => {
    if (line) out.push(`• ${line}`);
  };

  if (bucket === "closed") {
    push(closedCoaching(play));
    return out;
  }

  push(thesisBreakCoaching(play));
  push(thesisPillarCoaching(play));
  push(troughResilienceCoaching(play, bucket));

  if (bucket === "watch") {
    // DEAD CODE REMOVED (2026-09-15, Ask Largo standing mandate): `morningConfirmCoaching` (formerly
    // here) read `play.pulled`/`play.morningStatus`/`play.morningReason` — fields genuinely populated
    // for Legacy (`terminalPlayFromEdition`, adapters.ts) but NEVER for swing/LEAPS. The swing/LEAPS
    // adapter (`terminalPlayFromHorizon`) never sets any of the three, and its own input type
    // (`HorizonDeckSource`) doesn't even carry a `morning_status`/`pulled` field to source them from
    // — confirmed via grep across both. Same dead-code shape as `scorecardCoaching`, removed the same
    // day for the identical reason (a field genuinely live for a sibling lane, structurally never
    // populated for swing, read by a function called unconditionally in the swing assembly anyway).
    push(watchGateCoaching(play));
    // flagUnderlyingPx/entryStatus are NOT re-rendered here — watchForSection (play-brief-intel.ts,
    // "Watch levels") already renders the same two facts ("Flag anchor: X — track move from here"
    // / "Entry geometry: X") and both sections render together for every WATCH-bucket play. This
    // module (#4104, 2026-09-05) duplicated them into coaching hours after play-brief-intel.ts
    // (#4056, same day) had already shipped them — same near-verbatim-duplicate-fact class as the
    // recNote/rails (#4261) and earnings-warning (#4757) fixes; found 2026-09-11 auditing the
    // WATCH-bucket brief for GOOG. Kept in "Watch levels" (not here) because that section's whole
    // job is to be the literal key-levels reference; these two coaching bullets restated the same
    // terse fact rather than adding trade-manager narrative, so they added no information.
  }

  push(manageLifecycleCoaching(play, bucket));
  push(catalystCoaching(ctx));
  // Meridian peer earnings live in meridianPeerSection (play-brief-intel.ts) — not here.
  // Duplicating meridianPeerEarningsCoaching in both places re-shipped the #4110/#4116
  // book-context failure mode when MAX_BULLETS had room.
  const crossDesk = crossDeskCoaching(ctx, play);
  push(crossDesk);
  // Threaded into vectorPlayCoaching below — see that function's own doc comment for why.
  const vectorConflictAlreadyNoted = crossDesk != null && /Vector (bearish|bullish)/.test(crossDesk);
  push(laneRankCoaching(play, ctx.laneRows));
  push(macroTapeCoaching(ctx));
  // DEAD CODE REMOVED (2026-09-15, Ask Largo standing mandate): `scorecardCoaching` (formerly here)
  // read `play.scorecard`, which is genuinely populated for 0DTE (zerodte-sources.ts) and Legacy
  // (legacy-board-detail-copy.ts) but NEVER for swing/LEAPS — `terminalPlayFromHorizon` (adapters.ts,
  // the SWING/LEAPS adapter) never sets it, and no swing-side resolve step patches it in either
  // (confirmed: zero `scorecard` references in that function or in play-brief-resolve.ts). That made
  // this call structurally guaranteed to return null for 100% of swing traffic, forever, by the same
  // architectural decision adapters.ts already documents for `tierLabel: null` on swing ("no
  // calibrated tier engine to back" a letter grade) — not a missing signal to wire up, since swing
  // already ships the honest, superior replacement for this exact intent
  // (`archetypeTrackRecordSection`/`graduatedArchetypeEntry`, #4685, Wilson-LB gated, sub-lane-
  // specific). Removed rather than left as always-dead code a future reader could mistake for live.
  // DEAD CODE REMOVED (2026-09-15, Ask Largo standing mandate): `progressRatchetCoaching` (formerly
  // here) gated on `play.exitModel === "RATCHET"`. `terminalPlayFromHorizon` (the SWING/LEAPS
  // adapter) hardcodes `exitModel: "SCALE_OUT"` unconditionally for every swing/LEAPS row (confirmed:
  // grepped the function's real body, only the literal "SCALE_OUT" ever appears, no "RATCHET" branch
  // exists, and no swing-side resolve step overrides it) — "RATCHET" is a real value elsewhere
  // (0DTE/terminal-guards.ts), just never for this lane. `play.progress` itself IS live for swing
  // (already rendered honestly via "Trim progress: X%" in play-brief.ts's Position section, which
  // has no RATCHET dependency), so nothing computable was lost — same dead-gate shape as
  // `scorecardCoaching`/`morningConfirmCoaching`, removed the same week for the identical reason.
  push(execSlippageCoaching(play));
  // DEAD CODE REMOVED (2026-09-15, Ask Largo standing mandate): `underlyingExcursionCoaching`
  // (formerly here) gated on `play.stockMovePct`/`stockPeakPct`/`stockTroughPct` — fields written in
  // exactly one place repo-wide, `use-legacy-quotes.ts` (a client-side, Legacy-only React hook).
  // `terminalPlayFromHorizon` never sets them and `play-brief-resolve.ts` never patches them in, so
  // the "stock **X%** since flag" / "peak" / "trough" clause could never render for swing. The
  // function's one live-computable remainder — an option round-trip/giveback aside via
  // `mfeCaptureOutcome(play.pnlPct, play.peak, null)` — is byte-for-byte the SAME call, same
  // arguments, already live in `play-brief-intel.ts` and `play-brief-narrative.ts` (both predate
  // this function), so nothing unique was actually lost: this call site was fully redundant with
  // already-shipped content even before accounting for the dead gate around it.
  push(shortInterestCoaching(ctx, play));
  push(ivRankCoaching(play));

  if (spot != null) {
    push(vexCoaching(vec, spot, ctx.sessionDate));
    push(flowPrintsCoaching(vec, play, ctx.sessionDate));
    push(magnetCoaching(ctx, vec, spot));
    push(confluenceCoaching(vec, play, spot, ctx.sessionDate));
    push(expectedMoveCoaching(vec, spot, ctx.sessionDate));
    push(wallIntegrityCoaching(vec, play, ctx.sessionDate));
    push(wallDynamicsCoaching(vec, ctx.sessionDate));
    push(technicalsCoaching(vec, play, ctx.sessionDate));
  } else {
    push(vexCoaching(vec, null, ctx.sessionDate));
    push(flowPrintsCoaching(vec, play, ctx.sessionDate));
  }

  push(vectorPlayCoaching(vec, play, ctx.sessionDate, vectorConflictAlreadyNoted));
  push(dataHonestyCoaching(ctx, play));

  return out;
}
