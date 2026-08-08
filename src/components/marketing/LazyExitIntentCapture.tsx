"use client";

import dynamic from "next/dynamic";

// Isolated into its own "use client" file because `ssr: false` on next/dynamic
// is only allowed inside a Client Component — MarketingPageShell (the caller)
// stays a Server Component, so the dynamic() call can't live there directly.
//
// Dynamic, not a static import: ExitIntentCapture pulls in Modal -> framer-motion
// (~35KB transferred), which PageSpeed Insights measured as >90% unused on the
// homepage — the modal is invisible until a 4s-delayed mouse-exit gesture, but a
// static import bundles its code (and framer-motion) into every marketing page's
// initial JS regardless of whether that gesture ever fires. ssr:false is safe: the
// component is itself "use client" and renders nothing server-side-relevant (a
// closed Modal), so there's no hydration mismatch to worry about.
export const LazyExitIntentCapture = dynamic(
  () => import("@/components/marketing/ExitIntentCapture").then((m) => m.ExitIntentCapture),
  { ssr: false },
);
