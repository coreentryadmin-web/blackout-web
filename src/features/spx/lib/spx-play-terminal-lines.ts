import type { SpxDeskPayload } from "@/features/spx/lib/spx-desk";
import type { SpxPlayPayload } from "@/features/spx/lib/spx-play-engine";
import type { LottoPlayPayload } from "@/features/spx/lib/spx-lotto-engine";
import type { PowerHourPlayPayload } from "@/features/spx/lib/spx-power-hour-engine";
import type { PlayConfirmationLayer } from "@/features/spx/hooks/useStablePlayConfirmations";
import type { TradeAlertPlay } from "@/features/spx/lib/spx-trade-alert-plays";
import { fmtPrice } from "@/lib/api";

export type PlayTerminalIcon =
  | "prompt"
  | "section"
  | "ok"
  | "no"
  | "vwap"
  | "flow"
  | "gamma"
  | "level"
  | "news"
  | "trim"
  | "sell"
  | "watch"
  | "dim"
  | "pulse";

export type PlayTerminalLine = {
  icon: PlayTerminalIcon;
  tone: "bull" | "bear" | "neutral" | "accent" | "warn" | "dim";
  text: string;
  indent?: number;
};

function moneyShort(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `$${Math.round(n / 1_000)}K`;
  return `$${Math.round(n)}`;
}

function section(title: string): PlayTerminalLine {
  return { icon: "section", tone: "accent", text: title };
}

function structureSectionTitle(play: SpxPlayPayload): string {
  switch (play.action) {
    case "TRIM":
      return "WHY TRIM";
    case "SELL":
      return "EXIT LOG";
    case "WATCHING":
      return "WHY WATCH";
    case "BUY":
      return "ENTRY SIGNAL";
    default:
      return "WHY HOLD";
  }
}

function structureLines(
  play: SpxPlayPayload,
  desk: SpxDeskPayload | undefined,
  confirmationLayer: PlayConfirmationLayer | null
): PlayTerminalLine[] {
  const lines: PlayTerminalLine[] = [];
  const dir = play.direction;
  const open = play.open_play;

  lines.push(section(structureSectionTitle(play)));
  lines.push({ icon: "dim", tone: "dim", text: play.headline, indent: 1 });
  if (play.thesis) {
    lines.push({ icon: "prompt", tone: "neutral", text: play.thesis, indent: 1 });
  }

  if (desk?.vwap != null && desk.price > 0) {
    const above = desk.above_vwap ?? desk.price >= desk.vwap;
    const dist = desk.price - desk.vwap;
    lines.push({
      icon: "vwap",
      tone: above ? "bull" : "bear",
      text: above
        ? `Above VWAP ${fmtPrice(desk.vwap)} (+${Math.abs(dist).toFixed(1)} pts) — buyers in control`
        : `Below VWAP ${fmtPrice(desk.vwap)} (−${Math.abs(dist).toFixed(1)} pts) — sellers pressing`,
      indent: 1,
    });
  }

  if (desk?.flow_0dte_net != null && Math.abs(desk.flow_0dte_net) > 0) {
    const net = desk.flow_0dte_net;
    const aligned =
      dir === "long" ? net > 0 : dir === "short" ? net < 0 : net !== 0;
    lines.push({
      icon: "flow",
      tone: aligned ? "bull" : "bear",
      text: `0DTE flow net ${moneyShort(net)}${aligned ? " · aligned with bias" : " · opposes bias"}`,
      indent: 1,
    });
  }

  const flowFactor = play.factors.find((f) => /flow|helix|sweep|premium/i.test(f.label + f.detail));
  if (flowFactor) {
    lines.push({
      icon: "flow",
      tone: flowFactor.weight > 0 ? "bull" : flowFactor.weight < 0 ? "bear" : "neutral",
      text: `${flowFactor.label}: ${flowFactor.detail}`,
      indent: 1,
    });
  }

  for (const f of play.factors) {
    if (flowFactor && f === flowFactor) continue;
    if (/vwap/i.test(f.label)) continue;
    lines.push({
      icon: /gamma|gex|flip|king|wall/i.test(f.label) ? "gamma" : /level|hod|lod|pdh|pdl|or/i.test(f.label) ? "level" : "ok",
      tone: f.weight > 0 ? "bull" : f.weight < 0 ? "bear" : "neutral",
      text: `${f.label}: ${f.detail}`,
      indent: 1,
    });
  }

  const checks = confirmationLayer?.confirmations.checks ?? play.confirmations?.checks ?? [];
  if (checks.length > 0) {
    lines.push(section("CONFIRMATIONS"));
    for (const c of checks.slice(0, 8)) {
      lines.push({
        icon: c.passed ? "ok" : "no",
        tone: c.passed ? "bull" : "bear",
        text: `${c.label} — ${c.detail}`,
        indent: 1,
      });
    }
  }

  if (open) {
    lines.push(section("POSITION"));
    lines.push({
      icon: "level",
      tone: "neutral",
      text: `Entry ${fmtPrice(open.entry_price)} · stop ${fmtPrice(open.stop)} · target ${fmtPrice(open.target)}`,
      indent: 1,
    });
    if (open.mfe_pts > 0) {
      lines.push({
        icon: play.action === "TRIM" || open.trim_done ? "trim" : "pulse",
        tone: "accent",
        text: `MFE +${open.mfe_pts.toFixed(1)} pts${open.trim_done ? " · trim logged" : play.action === "TRIM" ? " · trim zone" : ""}`,
        indent: 1,
      });
    }
    if (play.levels.invalidation) {
      lines.push({
        icon: "sell",
        tone: "warn",
        text: `Invalidation: ${play.levels.invalidation}`,
        indent: 1,
      });
    }
  }

  if (play.watch?.active && play.action === "WATCHING") {
    lines.push(section("WATCH ARM"));
    if (play.watch.reason) {
      lines.push({ icon: "watch", tone: "accent", text: play.watch.reason, indent: 1 });
    }
    if (play.watch.promote_ready) {
      lines.push({ icon: "ok", tone: "bull", text: "Promote ready — confirmations stacking", indent: 1 });
    }
  }

  return lines;
}

function lottoLines(lotto: LottoPlayPayload): PlayTerminalLine[] {
  const lines: PlayTerminalLine[] = [];
  const title =
    lotto.phase === "WATCH" ? "WHY WATCH" : lotto.phase === "SELL" || lotto.phase === "INVALID" ? "EXIT LOG" : "WHY HOLD";
  lines.push(section(title));
  lines.push({ icon: "dim", tone: "dim", text: lotto.headline, indent: 1 });
  if (lotto.thesis) lines.push({ icon: "prompt", tone: "neutral", text: lotto.thesis, indent: 1 });
  if (lotto.catalyst_summary) {
    lines.push({ icon: "news", tone: "accent", text: `Catalyst: ${lotto.catalyst_summary}`, indent: 1 });
  }
  if (lotto.flow_summary) {
    lines.push({ icon: "flow", tone: "bull", text: lotto.flow_summary, indent: 1 });
  }
  for (const c of lotto.catalysts.slice(0, 6)) {
    lines.push({ icon: "ok", tone: "neutral", text: c, indent: 1 });
  }
  if (lotto.invalidation) {
    lines.push({ icon: "sell", tone: "warn", text: `Invalidation: ${lotto.invalidation}`, indent: 1 });
  }
  lines.push({ icon: "pulse", tone: "dim", text: lotto.status_message, indent: 1 });
  return lines;
}

function powerLines(power: PowerHourPlayPayload): PlayTerminalLine[] {
  const lines: PlayTerminalLine[] = [];
  const title = power.phase === "WATCH" ? "WHY WATCH" : power.phase === "SELL" ? "EXIT LOG" : "WHY HOLD";
  lines.push(section(title));
  lines.push({ icon: "dim", tone: "dim", text: power.headline, indent: 1 });
  if (power.thesis) lines.push({ icon: "prompt", tone: "neutral", text: power.thesis, indent: 1 });
  if (power.pnl_pts != null) {
    lines.push({
      icon: "level",
      tone: power.pnl_pts >= 0 ? "bull" : "bear",
      text: `PnL ${power.pnl_pts >= 0 ? "+" : ""}${power.pnl_pts.toFixed(1)} pts`,
      indent: 1,
    });
  }
  lines.push({ icon: "pulse", tone: "dim", text: power.status_message, indent: 1 });
  return lines;
}

export function buildPlayTerminalLines(input: {
  selected: TradeAlertPlay | null;
  play: SpxPlayPayload | null;
  lotto: LottoPlayPayload | null;
  powerHour: PowerHourPlayPayload | null;
  desk?: SpxDeskPayload;
  confirmationLayer: PlayConfirmationLayer | null;
  closedThesis?: string;
}): PlayTerminalLine[] {
  const { selected, play, lotto, powerHour, desk, confirmationLayer, closedThesis } = input;
  if (!selected) {
    return [
      { icon: "prompt", tone: "dim", text: "awaiting play selection…" },
      { icon: "dim", tone: "dim", text: "select a play from Open, Watch, or Closed" },
    ];
  }

  if (selected.chip.kind === "structure" && play) {
    const lines = structureLines(play, desk, confirmationLayer);
    if (selected.chip.column === "closed" && closedThesis) {
      lines.push(section("SESSION WRAP"));
      lines.push({ icon: "dim", tone: "dim", text: closedThesis, indent: 1 });
    }
    return lines;
  }
  if (selected.chip.kind === "lotto" && lotto) return lottoLines(lotto);
  if (selected.chip.kind === "power" && powerHour) return powerLines(powerHour);

  return [{ icon: "dim", tone: "dim", text: "No live feed for this play." }];
}

export function playTerminalTitle(selected: TradeAlertPlay | null): string {
  if (!selected) return "blackout — play terminal";
  return `blackout — ${selected.chip.label} · ${selected.chip.column}`;
}
