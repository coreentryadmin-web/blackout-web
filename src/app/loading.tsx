import { PhosphorBoot } from "@/components/ui/loading/PhosphorBoot";

// Route-level loading UI for the App Router. Server component, dependency-light —
// renders on any navigation/suspense boundary so it must not pull in Nav or data.
// The visual (cold-violet CRT ladder booting) lives in PhosphorBoot; all its
// motion is CSS-only and prefers-reduced-motion gated in phosphor-loading.css.
export default function Loading() {
  return <PhosphorBoot />;
}
