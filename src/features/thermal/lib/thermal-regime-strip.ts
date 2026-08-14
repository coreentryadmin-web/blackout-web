import { fmtPremium } from "@/lib/fmt-money";
import { fmtHeatmapStrike } from "@/lib/gex-heatmap-display";

export type RegimeStripLens = "gex" | "vex" | "dex" | "charm";

export type RegimeStripSegment = {
  key: string;
  icon?: string;
  label: string;
  value: string;
  tone?: "bull" | "bear" | "flip" | "wall" | "sky" | "neutral";
  /** Intraday / vs-prior delta chip — never fabricated. */
  delta?: string | null;
};

export type RegimeStripBadge = {
  emoji: string;
  text: string;
  tone: "bull" | "bear" | "sky" | "wall" | "neutral";
};

export type ThermalRegimeStripModel = {
  kicker: string;
  footnote?: string | null;
  badge: RegimeStripBadge | null;
  segments: RegimeStripSegment[];
  interpretation: string | null;
};

export type BuildThermalRegimeStripInput = {
  lens: RegimeStripLens;
  kicker: string;
  footnote?: string | null;
  spot: number;
  flip: number | null;
  callWall: number | null;
  putWall: number | null;
  maxPain: number | null;
  netTotal: number;
  magnetStrike: number | null;
  /** GEX/VEX posture from server regime block. */
  gammaPosture?: "long" | "short" | null;
  vannaPosture?: "positive" | "negative" | null;
  dexPosture?: "long" | "short" | null;
  charmPosture?: "positive" | "negative" | null;
  netDelta?: string | null;
  netDeltaTone?: "bull" | "bear" | "neutral" | null;
  /** Server regime read — used as interpretation fallback when builder cannot ground a line. */
  serverRead?: string | null;
  /** Intraday GEX migration proxy on DEX/CHARM lenses — omitted when unavailable. */
  gexShiftNet?: number | null;
};

function fmtStrike(n: number): string {
  return fmtHeatmapStrike(n);
}

function fmtSignedMoney(n: number): string {
  if (!Number.isFinite(n)) return "—";
  if (n === 0) return fmtPremium(0);
  if (n < 0) return fmtPremium(n);
  return `+${fmtPremium(n)}`;
}

function volLabelForGamma(posture: "long" | "short" | null | undefined): string | null {
  if (posture === "long") return "SUPPRESSED";
  if (posture === "short") return "EXPANDED";
  return null;
}

function volLabelForVanna(posture: "positive" | "negative" | null | undefined): string | null {
  if (posture === "positive") return "AMPLIFYING";
  if (posture === "negative") return "FADING";
  return null;
}

/** One-line dealer read — grounded on spot, flip, posture, and optional magnet strike only. */
export function buildGexRegimeInterpretation(input: {
  flip: number | null;
  posture: "long" | "short" | null;
  magnetStrike: number | null;
  callWall: number | null;
}): string | null {
  const { flip, posture, magnetStrike, callWall } = input;
  if (flip == null || posture == null) return null;

  const parts: string[] = [];
  if (posture === "long") {
    parts.push(`Dealers remain stabilizing above ${fmtStrike(flip)}.`);
  } else {
    parts.push(`Dealers are amplifying moves below ${fmtStrike(flip)}.`);
  }

  if (magnetStrike != null) {
    parts.push(`${fmtStrike(magnetStrike)} is the dominant pin.`);
  } else if (callWall != null && posture === "long") {
    parts.push(`${fmtStrike(callWall)} is the dominant upside magnet.`);
  }

  if (posture === "long") {
    parts.push(`A loss of ${fmtStrike(flip)} changes the regime.`);
  } else {
    parts.push(`A reclaim of ${fmtStrike(flip)} changes the regime.`);
  }

  return parts.join(" ");
}

function gexBadge(posture: "long" | "short" | null | undefined): RegimeStripBadge | null {
  if (posture === "long") return { emoji: "🟢", text: "LONG GAMMA", tone: "bull" };
  if (posture === "short") return { emoji: "🔴", text: "SHORT GAMMA", tone: "bear" };
  return null;
}

function vexBadge(posture: "positive" | "negative" | null | undefined): RegimeStripBadge | null {
  if (posture === "positive") return { emoji: "🟢", text: "POSITIVE VANNA", tone: "sky" };
  if (posture === "negative") return { emoji: "🔴", text: "NEGATIVE VANNA", tone: "bear" };
  return null;
}

function dexBadge(posture: "long" | "short" | null | undefined): RegimeStripBadge | null {
  if (posture === "long") return { emoji: "🟢", text: "LONG DELTA", tone: "bull" };
  if (posture === "short") return { emoji: "🔴", text: "SHORT DELTA", tone: "bear" };
  return null;
}

function charmBadge(posture: "positive" | "negative" | null | undefined): RegimeStripBadge | null {
  if (posture === "positive") return { emoji: "🟢", text: "POSITIVE CHARM", tone: "wall" };
  if (posture === "negative") return { emoji: "🔴", text: "NEGATIVE CHARM", tone: "bear" };
  return null;
}

function segment(
  key: string,
  label: string,
  value: string,
  opts?: Partial<Pick<RegimeStripSegment, "icon" | "tone" | "delta">>
): RegimeStripSegment {
  return { key, label, value, ...opts };
}

/** Build the intelligence strip model for the active lens — never fabricates missing levels. */
export function buildThermalRegimeStrip(input: BuildThermalRegimeStripInput): ThermalRegimeStripModel {
  const {
    lens,
    kicker,
    footnote,
    flip,
    callWall,
    putWall,
    maxPain,
    netTotal,
    magnetStrike,
    gammaPosture,
    vannaPosture,
    dexPosture,
    charmPosture,
    netDelta,
    netDeltaTone,
    serverRead,
    gexShiftNet,
  } = input;

  const netDeltaChip =
    netDelta && netDeltaTone && netDeltaTone !== "neutral"
      ? netDelta.startsWith("+") || netDelta.startsWith("-")
        ? netDelta
        : netDelta === "held"
          ? null
          : netDelta
      : null;

  if (lens === "gex") {
    const badge = gexBadge(gammaPosture);
    const segments: RegimeStripSegment[] = [
      segment("netGex", "Net GEX", fmtSignedMoney(netTotal), {
        tone: netTotal >= 0 ? "bull" : "bear",
        delta: netDeltaChip,
      }),
    ];
    if (magnetStrike != null) {
      segments.push(
        segment("anchor", "Magnet", fmtStrike(magnetStrike), { icon: "🧲", tone: "wall" })
      );
    }
    if (flip != null) {
      segments.push(segment("flip", "Flip", fmtStrike(flip), { icon: "⚡", tone: "flip" }));
    }
    if (callWall != null) {
      segments.push(
        segment("callWall", "Call Wall", fmtStrike(callWall), { icon: "🧱", tone: "bull" })
      );
    }
    if (putWall != null) {
      segments.push(
        segment("putWall", "Put Wall", fmtStrike(putWall), { icon: "🛡", tone: "bear" })
      );
    }
    const vol = volLabelForGamma(gammaPosture);
    if (vol) segments.push(segment("vol", "VOL", vol, { tone: "sky" }));

    const interpretation =
      buildGexRegimeInterpretation({
        flip,
        posture: gammaPosture ?? null,
        magnetStrike,
        callWall,
      }) ??
      serverRead ??
      null;

    return { kicker, footnote, badge, segments, interpretation };
  }

  if (lens === "vex") {
    const badge = vexBadge(vannaPosture);
    const segments: RegimeStripSegment[] = [
      segment("netVex", "Net VEX", fmtSignedMoney(netTotal), {
        tone: netTotal >= 0 ? "sky" : "bear",
        delta: netDeltaChip,
      }),
    ];
    if (callWall != null) {
      segments.push(segment("posWall", "+Vanna Wall", fmtStrike(callWall), { icon: "🧱", tone: "sky" }));
    }
    if (putWall != null) {
      segments.push(segment("negWall", "−Vanna Wall", fmtStrike(putWall), { icon: "🛡", tone: "wall" }));
    }
    if (flip != null) {
      segments.push(segment("flip", "Vanna Flip", fmtStrike(flip), { icon: "⚡", tone: "flip" }));
    }
    if (maxPain != null) {
      segments.push(segment("maxPain", "Max Pain", fmtStrike(maxPain), { tone: "sky" }));
    }
    const vol = volLabelForVanna(vannaPosture);
    if (vol) segments.push(segment("vol", "VOL", vol, { tone: "sky" }));

    return { kicker, footnote, badge, segments, interpretation: serverRead ?? null };
  }

  if (lens === "dex") {
    const badge = dexBadge(dexPosture);
    const segments: RegimeStripSegment[] = [
      segment("netDex", "Net DEX", fmtSignedMoney(netTotal), {
        tone: netTotal >= 0 ? "flip" : "bear",
        delta: netDeltaChip,
      }),
    ];
    if (flip != null) {
      segments.push(segment("zero", "Delta-Zero", fmtStrike(flip), { icon: "⚡", tone: "flip" }));
    }
    if (gexShiftNet != null) {
      segments.push(
        segment("gexShiftDelta", "GEX Shift Δ", fmtSignedMoney(gexShiftNet), {
          tone: gexShiftNet >= 0 ? "bull" : "bear",
        })
      );
    }
    return { kicker, footnote, badge, segments, interpretation: serverRead ?? null };
  }

  const badge = charmBadge(charmPosture);
  const segments: RegimeStripSegment[] = [
    segment("netCharm", "Net CHARM", fmtSignedMoney(netTotal), {
      tone: netTotal >= 0 ? "wall" : "bear",
      delta: netDeltaChip,
    }),
  ];
  if (flip != null) {
    segments.push(segment("zero", "Charm-Zero", fmtStrike(flip), { icon: "⚡", tone: "wall" }));
  }
  if (gexShiftNet != null) {
    segments.push(
      segment("gexShiftDelta", "GEX Shift Δ", fmtSignedMoney(gexShiftNet), {
        tone: gexShiftNet >= 0 ? "bull" : "bear",
      })
    );
  }
  return { kicker, footnote, badge, segments, interpretation: serverRead ?? null };
}
