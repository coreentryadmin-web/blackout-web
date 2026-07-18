/** Ambient radar HUD — CSS lives in globals.css (.nighthawk-radar-*). */
export function NighthawkRadarBackdrop() {
  return (
    <>
      <div className="nighthawk-radar-backdrop" aria-hidden />
      <div className="nighthawk-radar-hud" aria-hidden>
        <div className="nighthawk-radar-vignette" />
        <div className="nighthawk-radar-grid" />
        <div className="nighthawk-radar-stage">
          <div className="nighthawk-radar-scope">
            <div className="nighthawk-radar-ring" style={{ width: "38%", height: "38%" }} />
            <div className="nighthawk-radar-ring" style={{ width: "62%", height: "62%" }} />
            <div className="nighthawk-radar-ring" style={{ width: "88%", height: "88%" }} />
            <div className="nighthawk-radar-crosshair-h" style={{ width: "100%", height: 1 }} />
            <div className="nighthawk-radar-crosshair-v" style={{ width: 1, height: "100%" }} />
            <div className="nighthawk-radar-sweep" />
            <div className="nighthawk-radar-core" />
            <div className="nighthawk-radar-blip" style={{ left: "58%", top: "42%" }}>
              <span className="nighthawk-radar-blip-label">FLOW</span>
            </div>
            <div className="nighthawk-radar-blip" style={{ left: "34%", top: "61%", animationDelay: "1.2s" }}>
              <span className="nighthawk-radar-blip-label">0DTE</span>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
