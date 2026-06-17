import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        black: "#000000",
        surface: {
          1: "#0a0a0a",
          2: "#111111",
          3: "#1a1a1a",
          4: "#222222",
        },
        border: {
          DEFAULT: "#1a1a1a",
          subtle: "#111111",
          strong: "#2a2a2a",
        },
        text: {
          primary: "#f0f0f0",
          secondary: "#888888",
          muted: "#444444",
          dim: "#2a2a2a",
        },
        bull: "#22c55e",
        bear: "#ef4444",
        warning: "#f59e0b",
        elite: "#f59e0b",
        glow: "rgba(255,255,255,0.08)",
      },
      fontFamily: {
        display: ["var(--font-bebas)", "sans-serif"],
        mono: ["var(--font-jetbrains)", "monospace"],
        sans: ["var(--font-inter)", "system-ui", "sans-serif"],
      },
      backgroundImage: {
        "eclipse-glow":
          "radial-gradient(ellipse at 50% 0%, rgba(255,255,255,0.04) 0%, transparent 60%)",
        "card-glow":
          "radial-gradient(ellipse at 50% -20%, rgba(255,255,255,0.03) 0%, transparent 50%)",
      },
      boxShadow: {
        eclipse: "0 0 120px 40px rgba(255,255,255,0.04), 0 0 300px 80px rgba(255,255,255,0.015)",
        glow: "0 0 20px rgba(255,255,255,0.06)",
        "glow-bull": "0 0 12px rgba(34,197,94,0.2)",
        "glow-bear": "0 0 12px rgba(239,68,68,0.2)",
      },
      animation: {
        "pulse-slow": "pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite",
        blink: "blink 1s step-end infinite",
        "fade-in": "fadeIn 0.4s ease-out",
        "slide-up": "slideUp 0.4s ease-out",
      },
      keyframes: {
        blink: {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0" },
        },
        fadeIn: {
          from: { opacity: "0" },
          to: { opacity: "1" },
        },
        slideUp: {
          from: { opacity: "0", transform: "translateY(8px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
      },
    },
  },
  plugins: [],
};

export default config;
