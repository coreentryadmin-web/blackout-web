"use client";

// Thin client wrapper so the decorative DNA-helix background (framer-motion via
// useReducedMotion) can be loaded with next/dynamic({ ssr:false }). The helix is
// imported by flows/page.tsx, which is a Server Component, and App Router forbids
// ssr:false inside Server Components — hence this "use client" boundary.
// The background is purely decorative (aria-hidden, fixed, zIndex 0), so skipping
// SSR is visually invisible and keeps the helix's framer code out of the initial
// server-rendered payload / first client chunk for /flows.
import dynamic from "next/dynamic";

const DnaHelixBackground = dynamic(
  () => import("@/components/DnaHelixBackground").then((m) => m.DnaHelixBackground),
  { ssr: false, loading: () => null },
);

export function DnaHelixBackgroundLazy() {
  return <DnaHelixBackground />;
}

export default DnaHelixBackgroundLazy;
