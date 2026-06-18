"use client";

import { usePathname } from "next/navigation";
import { ScrollProgressBar } from "@/components/ScrollProgressBar";

export function LandingChrome() {
  const path = usePathname();
  if (path !== "/") return null;

  return <ScrollProgressBar />;
}
