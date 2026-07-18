import { clsx } from "clsx";
import type { PlaybookPlay, PlayMorningStatus } from "@/features/nighthawk/lib/types";
import { convictionFillPct } from "@/features/nighthawk/lib/play-briefing-utils";
import { formatPremiumCapLabel } from "@/features/nighthawk/lib/play-constraints";
import { MAX_OPTION_PREMIUM_PER_SHARE } from "@/features/nighthawk/lib/constants";
import { fmtIvRank, fmtScore, morningBadgeLabel } from "@/features/nighthawk/components/PlaybookPlayRow";
import { BriefingSection } from "./BriefingSection";
import { BriefingScoreBar } from "./BriefingScoreBar";

type Props = {
  play: PlaybookPlay;
  mode: "overview" | "scoring";
  morningConfirm?: PlayMorningStatus;
  morningConfirmCheckedAt?: string;
};

export function PlaybookBriefingPanel({ play, mode, morningConfirm }: Props) {
  const showKeySignal = Boolean(play.key_signal?.trim()) && play.key_signal !== play.thesis;
  const score = play.score != null && Number.isFinite(play.score) ? Math.round(play.score) : null;

  if (mode === "overview") {
    return (
      <div className="nh-v2-briefing-stack">
        <BriefingSection title="Thesis" accent="gold">
          <p className="nh-v2-briefing-prose">{play.thesis || play.key_signal || "—"}</p>
        </BriefingSection>

        {showKeySignal && (
          <BriefingSection title="Key signal" accent="green">
            <p className="nh-v2-briefing-prose">{play.key_signal}</p>
          </BriefingSection>
        )}

        <BriefingSection title="Trade plan" accent="sky">
          <div className="nh-v2-briefing-level-grid">
            <div className="nh-v2-briefing-level-tile">
              <em>Entry</em>
              <strong className="t-num">{play.entry_range}</strong>
            </div>
            <div className="nh-v2-briefing-level-tile">
              <em>Target</em>
              <strong className="t-num">{play.target}</strong>
            </div>
            <div className="nh-v2-briefing-level-tile">
              <em>Stop</em>
              <strong className="t-num">{play.stop}</strong>
            </div>
          </div>
          <p className="nh-v2-briefing-contract t-num mt-3">
            {play.options_play}
            <span className="nh-v2-briefing-cap">
              {formatPremiumCapLabel(play.entry_premium ?? null) ?? `≤$${MAX_OPTION_PREMIUM_PER_SHARE}`}
            </span>
          </p>
        </BriefingSection>

        {play.risk_note && (
          <BriefingSection title="Risk" accent="bear">
            <p className="nh-v2-briefing-prose">{play.risk_note}</p>
          </BriefingSection>
        )}

        {morningConfirm && (
          <BriefingSection title="Pre-market check" accent={morningConfirm.status === "CONFIRMED" ? "green" : "gold"}>
            <p className="nh-v2-briefing-verdict">{morningBadgeLabel(morningConfirm.status)}</p>
            <p className="nh-v2-briefing-prose mt-1">{morningConfirm.reason}</p>
          </BriefingSection>
        )}
      </div>
    );
  }

  return (
    <div className="nh-v2-briefing-stack">
      <BriefingSection title="Desk score" accent="gold">
        {score != null ? (
          <BriefingScoreBar label="Composite score" value={score} max={100} tone="gold" />
        ) : (
          <p className="nh-v2-briefing-muted">Score unavailable on this payload.</p>
        )}
        {play.conviction && (
          <div className="mt-3">
            <div className="nh-v2-conviction-meter max-w-xs">
              <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-gold/85">
                {play.conviction} conviction
              </span>
              <div className="nh-v2-conviction-meter-track mt-1">
                <div
                  className="nh-v2-conviction-meter-fill"
                  style={{ width: `${convictionFillPct(play.conviction)}%` }}
                />
              </div>
            </div>
          </div>
        )}
      </BriefingSection>

      <BriefingSection title="Factor inputs" accent="green">
        <ul className="nh-v2-factor-list">
          <li>
            <span>Rank</span>
            <strong>#{play.rank}</strong>
          </li>
          <li>
            <span>Play type</span>
            <strong className="uppercase">{play.play_type}</strong>
          </li>
          {play.flow_streak_days != null && (
            <li>
              <span>Flow streak</span>
              <strong>{Math.round(play.flow_streak_days)} sessions</strong>
            </li>
          )}
          {play.iv_rank != null && (
            <li>
              <span>IV rank</span>
              <strong>{fmtIvRank(play.iv_rank)}</strong>
            </li>
          )}
          {play.entry_premium != null && (
            <li>
              <span>Entry premium</span>
              <strong className="t-num">${play.entry_premium.toFixed(2)}/sh</strong>
            </li>
          )}
          {play.entry_cost_per_contract != null && (
            <li>
              <span>Per contract</span>
              <strong className="t-num">${Math.round(play.entry_cost_per_contract).toLocaleString()}</strong>
            </li>
          )}
          {play.rr_ratio != null && (
            <li>
              <span>R:R</span>
              <strong className="t-num">{play.rr_ratio.toFixed(1)}</strong>
            </li>
          )}
        </ul>
      </BriefingSection>

      {play.gate_promoted && play.gate_warnings?.length ? (
        <BriefingSection title="Gate caveats" accent="gold">
          <ul className="nh-v2-caveat-list">
            {play.gate_warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
          <p className="nh-v2-briefing-muted mt-2">Promoted as best available when no play fully cleared gates.</p>
        </BriefingSection>
      ) : (
        <BriefingSection title="Publish gates" accent="green">
          <p className={clsx("nh-v2-briefing-verdict", "text-bull")}>Cleared standard gates</p>
        </BriefingSection>
      )}

      {play.pulled && (
        <BriefingSection title="Pulled pre-open" accent="bear">
          <p className="nh-v2-briefing-prose">{play.pulled_reason ?? "Morning confirmation invalidated this setup."}</p>
        </BriefingSection>
      )}

      <BriefingSection title="Raw score" accent="sky">
        <p className="nh-v2-briefing-muted">
          Desk score <strong className="text-white">{fmtScore(play.score)}</strong> — ranked #{play.rank} in
          tonight&apos;s edition funnel.
        </p>
      </BriefingSection>
    </div>
  );
}
