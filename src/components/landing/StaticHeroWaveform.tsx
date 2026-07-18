/** Decorative RTH pulse line — CSS-only, matches Emergent mock waveform. */
export function StaticHeroWaveform() {
  return (
    <svg
      className="mkt-hero-waveform"
      viewBox="0 0 1440 320"
      preserveAspectRatio="none"
      fill="none"
      aria-hidden
    >
      <defs>
        <linearGradient id="mktWaveGrad" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#00e676" stopOpacity="0" />
          <stop offset="18%" stopColor="#00e676" stopOpacity="0.85" />
          <stop offset="50%" stopColor="#34d399" stopOpacity="1" />
          <stop offset="82%" stopColor="#00e676" stopOpacity="0.85" />
          <stop offset="100%" stopColor="#00e676" stopOpacity="0" />
        </linearGradient>
        <filter id="mktWaveGlow" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="3" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      <path
        filter="url(#mktWaveGlow)"
        d="M0,168 L60,168 L95,108 L130,228 L165,148 L200,188 L240,168 L320,168 L360,128 L400,208 L440,158 L520,168 L580,118 L640,218 L700,148 L760,178 L820,168 L900,138 L960,198 L1020,158 L1080,168 L1140,98 L1200,238 L1260,168 L1320,148 L1440,168"
        stroke="url(#mktWaveGrad)"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
