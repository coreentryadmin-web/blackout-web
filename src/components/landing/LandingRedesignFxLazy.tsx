"use client";

import dynamic from "next/dynamic";

/** Lazy FX layer — keeps the ~90KB canvas/reveal module out of the homepage critical path. */
export const LandingRedesignFxLazy = dynamic(
  () => import("./LandingRedesignFx").then((m) => m.LandingRedesignFx),
  { ssr: false }
);
