const LOG_LINES = [
  { t: "09:31:02", tag: "SYS", msg: "blackout-intelligence v3 · desk online" },
  { t: "09:31:04", tag: "SYS", msg: "connecting institutional feeds · 12 channels" },
  { t: "09:31:06", tag: " OK", msg: "UW websocket · options + net flow authenticated" },
  { t: "09:31:11", tag: "FLW", msg: "HELIX · SPXW 6030C sweep · $1.2M prem · bullish" },
  { t: "09:31:18", tag: "BIE", msg: "SPX 0DTE · gamma wall 6025 · charm supports above spot" },
  { t: "09:31:26", tag: "ALT", msg: "SPX Slayer · graded B+ · dealer pin lift · tape confirms" },
  { t: "09:31:33", tag: "GEX", msg: "Thermal · flip zone 6010–6020 · cross-check ✓" },
  { t: "09:31:41", tag: "FLW", msg: "HELIX · QQQ put block · hedge context only" },
  { t: "09:31:48", tag: "NH ", msg: "Night Hawk · playbook queued · push after gate" },
  { t: "09:31:55", tag: " OK", msg: "verification complete · snapshot fresh" },
];

const TAG_COLOR: Record<string, string> = {
  SYS: "#7dd3fc",
  " OK": "#00e676",
  FLW: "#22d3ee",
  BIE: "#ffd23f",
  ALT: "#00e676",
  GEX: "#bf5fff",
  "NH ": "#ff6b2b",
};

/** CSS-only desk terminal mock — Skylit-style agent log, BlackOut-native copy. */
export function StaticTerminalDemo() {
  return (
    <section id="desk" className="mkt-section mkt-section-alt border-b-0">
      <div className="mkt-section-inner mkt-terminal-layout">
        <div className="mkt-terminal-copy">
          <p className="mkt-kicker">
            <span className="mkt-kicker-dot" aria-hidden />
            Where intelligence meets alpha
          </p>
          <h2 className="mt-3 font-anton text-4xl text-white md:text-5xl">
            BIE IN <span className="mkt-gradient-text">REAL TIME.</span>
          </h2>
          <p className="mkt-lede !mx-0 !mt-4 !max-w-xl !text-left !text-sm md:!text-base">
            BlackOut Intelligence cuts through noise — verification, cross-checks, and graded alerts before
            anything hits your broker. Desk-native output, not a chat box.
          </p>
          <ul className="mkt-terminal-points">
            <li>Verification gate on every alert</li>
            <li>Cross-tool context in one log</li>
            <li>Full trade lifecycle on one surface</li>
          </ul>
        </div>

        <div className="mkt-terminal mkt-terminal--bie" aria-label="Example desk log (illustrative)">
          <div className="mkt-terminal-chrome">
            <span className="mkt-terminal-dot mkt-terminal-dot-red" />
            <span className="mkt-terminal-dot mkt-terminal-dot-amber" />
            <span className="mkt-terminal-dot mkt-terminal-dot-green" />
            <span className="mkt-terminal-title font-mono text-[10px] uppercase tracking-[0.35em] text-white/50">
              blackout-intelligence
            </span>
            <span className="mkt-terminal-live font-mono text-[10px] uppercase tracking-[0.2em] text-bull">
              <span className="mkt-scene-live-dot" aria-hidden />
              live
            </span>
          </div>
          <div className="mkt-terminal-body">
            <ul className="mkt-terminal-log mkt-terminal-log--bie">
              {LOG_LINES.map((line, i) => (
                <li
                  key={line.t + line.msg}
                  className="mkt-terminal-line mkt-terminal-line--reveal"
                  style={{ animationDelay: `${0.4 + i * 0.12}s` }}
                >
                  <time className="mkt-terminal-time">{line.t}</time>
                  <span className="mkt-terminal-tag font-mono" style={{ color: TAG_COLOR[line.tag] ?? "#7dd3fc" }}>
                    [{line.tag}]
                  </span>
                  <span className="mkt-terminal-msg">{line.msg}</span>
                </li>
              ))}
            </ul>
            <div className="mkt-terminal-cursor" aria-hidden />
            <div className="mkt-terminal-fade" aria-hidden />
          </div>
        </div>
      </div>
    </section>
  );
}
