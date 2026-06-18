"use client";

const TICKER_A = [
  "FLOW ALERTS LIVE",
  "SPX 0DTE",
  "GEX FLIP",
  "DARK POOL",
  "WHALE DETECTED",
  "NIGHT HAWK",
  "LARGO ONLINE",
  "93K+ SIGNALS",
];

const TICKER_B = [
  "EXECUTE",
  "DOMINATE",
  "NO GUESSING",
  "DEALER GAMMA",
  "MAX PAIN",
  "IV CRUSH",
  "SWING PLAYS",
  "BLACKOUT",
];

type MarqueeStripProps = {
  items: string[];
  direction?: "left" | "right";
  variant?: "green" | "dark" | "red";
  dimmed?: boolean;
};

const variantStyles = {
  green: "bg-bull text-black border-y border-bull",
  dark: "bg-black text-bull border-y border-bull/30",
  red: "bg-bear/10 text-bear border-y border-bear/30",
};

export function MarqueeStrip({
  items,
  direction = "left",
  variant = "green",
  dimmed = false,
}: MarqueeStripProps) {
  const doubled = [...items, ...items];
  return (
    <div
      className={`overflow-hidden whitespace-nowrap py-4 landing-marquee-strip ${variantStyles[variant]} ${
        dimmed ? "opacity-60" : ""
      }`}
    >
      <div className={`inline-flex gap-8 ${direction === "left" ? "marquee-left" : "marquee-right"}`}>
        {doubled.map((item, i) => (
          <span
            key={`${item}-${i}`}
            className="inline-flex items-center gap-8 font-mono text-xs md:text-sm tracking-[0.25em] uppercase font-semibold shrink-0"
          >
            {item}
            <span className="landing-marquee-dot opacity-80">◆</span>
          </span>
        ))}
      </div>
    </div>
  );
}

export function MarqueeBlock() {
  return (
    <div className="landing-section landing-section-cut relative z-30">
      <MarqueeStrip items={TICKER_A} direction="left" variant="green" />
      <MarqueeStrip items={TICKER_B} direction="right" variant="dark" dimmed />
    </div>
  );
}
