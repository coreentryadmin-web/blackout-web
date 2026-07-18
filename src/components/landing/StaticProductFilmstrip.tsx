import type { CSSProperties } from "react";
import { MARKETING_MODULE_IMAGES, type MarketingModuleId } from "@/lib/images";

const STRIP: { id: MarketingModuleId; label: string; tag: string; accent: string }[] = [
  { id: "spx", label: "SPX Slayer", tag: "0DTE desk", accent: "#00e676" },
  { id: "helix", label: "HELIX", tag: "Flow tape", accent: "#22d3ee" },
  { id: "thermal", label: "Thermal", tag: "GEX matrix", accent: "#bf5fff" },
  { id: "largo", label: "Largo", tag: "Desk AI", accent: "#ffd23f" },
  { id: "hawk", label: "Night Hawk", tag: "Playbook", accent: "#ff6b2b" },
  { id: "vector", label: "Vector", tag: "Structure", accent: "#7c5cff" },
];

/** Horizontal product gallery — real module screenshots, CSS scroll-snap. */
export function StaticProductFilmstrip() {
  return (
    <section id="tape" className="mkt-filmstrip-section" aria-label="Platform product previews">
      <div className="mkt-section-inner">
        <p className="mkt-kicker mkt-kicker-center">
          <span className="mkt-kicker-dot" aria-hidden />
          Inside the desk
        </p>
        <p className="mkt-filmstrip-lede">
          Real surfaces from the live platform — not mockups.
        </p>
      </div>
      <div className="mkt-filmstrip-track-wrap">
        <ul className="mkt-filmstrip-track">
          {STRIP.map((item, i) => (
            <li
              key={item.id}
              id={item.id === "thermal" ? "gamma" : undefined}
              className="mkt-filmstrip-card"
              style={{ "--mkt-accent": item.accent, animationDelay: `${i * 0.06}s` } as CSSProperties}
            >
              <div className="mkt-filmstrip-card-chrome">
                <span className="mkt-filmstrip-dot" style={{ background: item.accent }} />
                <span className="font-mono text-[10px] uppercase tracking-[0.28em] text-white/55">{item.label}</span>
              </div>
              <div className="mkt-filmstrip-card-body">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={MARKETING_MODULE_IMAGES[item.id]}
                  alt={`${item.label} — ${item.tag}`}
                  className="mkt-filmstrip-shot"
                  width={640}
                  height={360}
                  loading={i < 2 ? "eager" : "lazy"}
                  decoding="async"
                />
                <div className="mkt-filmstrip-card-foot">
                  <span className="font-syne text-sm font-bold text-white">{item.label}</span>
                  <span className="font-mono text-[10px] uppercase tracking-[0.24em] text-sky-300">{item.tag}</span>
                </div>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
