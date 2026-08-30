const LANES = [
  { id: "methodology-spx", label: "SPX Slayer" },
  { id: "methodology-nighthawk", label: "Night Hawk" },
  { id: "methodology-zerodte", label: "0DTE Command" },
  { id: "methodology-disclaimer", label: "Disclaimer" },
] as const;

/** Sticky in-page jump nav — three products, never blended. */
export function MethodologyLaneNav() {
  return (
    <nav
      className="methodology-lane-nav"
      aria-label="Methodology sections"
    >
      <ul className="methodology-lane-nav-list">
        {LANES.map((lane) => (
          <li key={lane.id}>
            <a href={`#${lane.id}`} className="methodology-lane-nav-link">
              {lane.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
