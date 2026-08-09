"use client";

import { UserProfile } from "@clerk/nextjs";
import { useAppAuth } from "@/lib/auth-client";

const CLERK_APPEARANCE = {
  variables: {
    colorBackground: "#040407",
    colorText: "#f4f6fb",
    colorTextSecondary: "#9fb4d4",
    colorPrimary: "#a3e635",
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

  return <UserProfile appearance={CLERK_APPEARANCE} />;
}
