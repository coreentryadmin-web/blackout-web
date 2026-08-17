export type SocialContentArchetype =
  | "win_recap"
  | "live_desk"
  | "platform_showcase"
  | "track_record"
  | "play_evolution"
  | "morning_hook";

export type SocialContentPlayRow = {
  ticker: string;
  direction: string | null;
  status: string | null;
  strike: number | null;
  live_pnl_pct: number | null;
  entry_premium: number | null;
  last_mark: number | null;
};

export function detectSocialArchetype(question: string): SocialContentArchetype {
  const q = question.toLowerCase();
  if (/\b(win recap|winning play|winning 0dte|banger|doubled|runner|green on|hit target)\b/.test(q)) {
    return "win_recap";
  }
  if (/\b(track record|win rate|hit rate|our record|graded|performance stats)\b/.test(q)) {
    return "track_record";
  }
  if (/\b(showcase|full desk|platform|why blackout|six tools|whole desk)\b/.test(q)) {
    return "platform_showcase";
  }
  if (/\b(morning|pre-?open|before the bell|overnight)\b/.test(q)) {
    return "morning_hook";
  }
  if (/\b(play evolution|caught it|how we caught|timeline)\b/.test(q)) {
    return "play_evolution";
  }
  return "live_desk";
}

export function buildPostAngles(
  archetype: SocialContentArchetype,
  pack: {
    winners: SocialContentPlayRow[];
    board: {
      open_count: number;
      closed_today: number;
      best_winner_pct: number | null;
      worst_loser_pct: number | null;
    };
    spx: {
      spot: number | null;
      flip: number | null;
      gamma_regime: string | null;
      conflict: boolean;
    } | null;
    record_7d: {
      wins: number;
      losses: number;
      win_rate_pct: number | null;
      sample_size: number;
    } | null;
  },
): string[] {
  const angles: string[] = [];
  const top = pack.winners[0];
  switch (archetype) {
    case "win_recap":
      if (top) {
        angles.push(
          `Lead with ${top.ticker} ${top.direction ?? ""} — ${top.live_pnl_pct != null ? `${top.live_pnl_pct.toFixed(0)}%` : "live mark"} if still open/graded.`,
        );
        angles.push("Connect flow → positioning → board commit (Helix + Thermal + Night Hawk panels).");
      } else {
        angles.push("No winning plays on the board yet — honest session read or wait; do not invent P&L.");
      }
      break;
    case "platform_showcase":
      angles.push("One provocative trader question — what's missing from their stack?");
      angles.push("Weave 2–3 tools max; never list all six in one sentence.");
      angles.push("Attach Vector + Helix + Thermal; add Slayer/Night Hawk only for SPX stories.");
      break;
    case "track_record":
      if (pack.record_7d && pack.record_7d.sample_size >= 5) {
        angles.push(
          `Cite 7d 0DTE record: ${pack.record_7d.wins}W/${pack.record_7d.losses}L${pack.record_7d.win_rate_pct != null ? ` (${pack.record_7d.win_rate_pct.toFixed(0)}%)` : ""}.`,
        );
      } else {
        angles.push("Sample too thin — say so; do not quote a win rate.");
      }
      angles.push("Attach Night Hawk or 0DTE board + track record page if citing grades.");
      break;
    case "morning_hook":
      if (pack.spx?.spot != null) {
        angles.push(`Open on SPX ${Math.round(pack.spx.spot)} vs flip ${pack.spx.flip ?? "—"}.`);
      }
      angles.push("Night Hawk → Vector walls → first setup angle.");
      break;
    case "play_evolution":
      angles.push("Three-panel story: Night Hawk plan → Helix prints → Thermal flip/wall.");
      break;
    default:
      if (pack.spx?.spot != null) {
        angles.push(
          `Live SPX ${Math.round(pack.spx.spot)}, ${pack.spx.gamma_regime ?? "regime n/a"}, flip ${pack.spx.flip ?? "—"}.`,
        );
      }
      if (pack.spx?.conflict) {
        angles.push("Flow vs gamma conflict — tension hook.");
      }
      angles.push("One question traders would actually answer.");
  }
  return angles;
}
