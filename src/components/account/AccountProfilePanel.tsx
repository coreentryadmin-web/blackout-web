"use client";

import { UserProfile } from "@clerk/nextjs";
import { useAppAuth } from "@/lib/auth-client";
import { isClientCognitoAuth } from "@/lib/auth-provider";

const CLERK_APPEARANCE = {
  variables: {
    colorBackground: "#040407",
    colorText: "#f4f6fb",
    colorTextSecondary: "#9fb4d4",
    colorPrimary: "#00e676",
    colorNeutral: "rgba(255,255,255,0.16)",
    borderRadius: "12px",
  },
  elements: {
    card: "!bg-[rgba(8,9,14,0.6)] border border-white/10 shadow-[0_8px_40px_-8px_rgba(0,0,0,0.9)] !text-white",
    rootBox: "!text-white",
    navbar: "!bg-transparent border-r border-white/8 !text-white",
    navbarButton: "!text-sky-300 hover:!text-white hover:!bg-white/5",
    navbarButtonActive: "!text-white !bg-white/8",
    pageScrollBox: "!bg-transparent !text-white",
    // Header / identity
    headerTitle: "!text-white",
    headerSubtitle: "!text-sky-300",
    userPreviewMainIdentifier: "!text-white",
    userPreviewSecondaryIdentifier: "!text-sky-200",
    // Profile sections (the rows that were rendering dark)
    profileSectionTitle: "!text-white",
    profileSectionTitleText: "!text-white",
    profileSectionContent: "!text-sky-100",
    profileSectionPrimaryButton: "!text-bull hover:!text-bull/80",
    accordionTriggerButton: "!text-white hover:!bg-white/5",
    accordionContent: "!text-sky-100",
    // Form fields
    formFieldInput:
      "!bg-[rgba(255,255,255,0.06)] !border-white/15 !text-white placeholder:!text-sky-300/45 focus:!border-bull/60 [&:-webkit-autofill]:![-webkit-text-fill-color:#f4f6fb]",
    formFieldLabel: "!text-sky-300 text-[11px] uppercase tracking-[0.14em]",
    formFieldHintText: "!text-sky-300/60",
    formFieldSuccessText: "!text-bull",
    formFieldErrorText: "!text-bear",
    formButtonPrimary: "!bg-bull !text-[#040407] font-bold hover:!bg-bull/80",
    formButtonReset: "!text-sky-300 hover:!text-white",
    // Menus / selects / misc
    selectButton: "!text-white !bg-white/[0.04] !border-white/15",
    selectSearchInput: "!text-white !bg-[rgba(255,255,255,0.06)]",
    menuButton: "!text-white hover:!bg-white/5",
    badge: "!bg-white/8 !text-sky-300",
    dividerLine: "!bg-white/8",
    breadcrumbsItem: "!text-sky-300",
    breadcrumbsItemCurrent: "!text-white",
  },
};

export function AccountProfilePanel() {
  const { email, tier, signOut, isLoaded } = useAppAuth();

  if (isClientCognitoAuth()) {
    return (
      <div className="rounded-xl border border-white/10 bg-white/[0.02] p-6 space-y-4">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-sky-300/60">Email</p>
          <p className="text-white mt-1">{isLoaded ? email ?? "—" : "Loading…"}</p>
        </div>
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-sky-300/60">Membership</p>
          <p className="text-white mt-1 capitalize">{tier ?? "free"}</p>
        </div>
        <p className="font-mono text-xs text-sky-300/70">
          Password and profile changes are managed in the Cognito sign-in portal.
        </p>
        <button
          type="button"
          onClick={signOut}
          className="btn-outline-bull"
        >
          Sign out
        </button>
      </div>
    );
  }

  return <UserProfile appearance={CLERK_APPEARANCE} />;
}
