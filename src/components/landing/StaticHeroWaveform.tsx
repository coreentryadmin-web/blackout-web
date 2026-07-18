/** Decorative market-pulse waveform — two traces for depth, CSS-animated. */
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
          <stop offset="15%" stopColor="#00e676" stopOpacity="0.8" />
          <stop offset="50%" stopColor="#34d399" stopOpacity="1" />
          <stop offset="85%" stopColor="#00e676" stopOpacity="0.8" />
          <stop offset="100%" stopColor="#00e676" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="mktWaveGrad2" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#22d3ee" stopOpacity="0" />
          <stop offset="20%" stopColor="#22d3ee" stopOpacity="0.4" />
          <stop offset="50%" stopColor="#7dd3fc" stopOpacity="0.5" />
          <stop offset="80%" stopColor="#22d3ee" stopOpacity="0.4" />
          <stop offset="100%" stopColor="#22d3ee" stopOpacity="0" />
        </linearGradient>
        <filter id="mktWaveGlow" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="3" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <filter id="mktWaveGlow2" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="2" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      {/* Secondary trace — offset, faded, cyan-tinted */}
      <path
        filter="url(#mktWaveGlow2)"
        d="M0,172 L80,172 L120,142 L160,192 L220,162 L280,172 L360,152 L440,182 L520,162 L600,172 L680,132 L760,192 L840,172 L920,152 L1000,182 L1080,162 L1160,142 L1240,192 L1320,172 L1440,172"
        stroke="url(#mktWaveGrad2)"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
        opacity="0.5"
      />
      {/* Primary trace — sharper, green */}
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
