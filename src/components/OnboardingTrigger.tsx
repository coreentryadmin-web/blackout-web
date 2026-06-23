"use client";

import { SignedIn } from "@clerk/nextjs";
import { ONBOARDING_OPEN_EVENT } from "@/lib/onboarding-content";

/** "Learn" button for the nav — opens the onboarding guide for signed-in users. */
export function OnboardingTrigger({ className }: { className?: string }) {
  return (
    <SignedIn>
      <button
        type="button"
        className={className ?? "onboarding-nav-trigger"}
        onClick={() => window.dispatchEvent(new CustomEvent(ONBOARDING_OPEN_EVENT))}
      >
        Learn
      </button>
    </SignedIn>
  );
}
