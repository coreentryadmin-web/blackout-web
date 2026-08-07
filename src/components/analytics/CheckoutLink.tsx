"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { trackGa4Event } from "@/lib/analytics/ga4-client";
import { GA4_EVENTS } from "@/lib/analytics/ga4-events";
import { trackXEvent } from "@/lib/analytics/x-pixel";
import {
  appendAttributionToUrl,
  internalCampaignParams,
} from "@/lib/analytics/utm";

type CheckoutPlan = "community" | "monthly" | "yearly";

type Props = {
  href: string;
  plan: CheckoutPlan;
  className?: string;
  children: ReactNode;
  /** When set, append learn/article campaign UTMs on top of stored first-touch. */
  campaignSource?: "pricing" | "upgrade" | "learn";
  campaign?: string;
};

function attributedCheckoutHref(
  href: string,
  plan: CheckoutPlan,
  campaignSource?: Props["campaignSource"],
  campaign?: string,
): string {
  const overrides =
    campaignSource && campaign
      ? {
          ...internalCampaignParams(campaignSource, campaign),
          utm_content: plan,
        }
      : { utm_content: plan };
  return appendAttributionToUrl(href, overrides);
}

function onCheckoutClick(plan: CheckoutPlan) {
  trackGa4Event(GA4_EVENTS.beginCheckout, {
    plan,
    currency: "USD",
  });
  trackXEvent("tw-re1j3-begin_checkout", {
    value: plan === "yearly" ? 1999 : plan === "monthly" ? 199 : 49,
    currency: "USD",
  });
}

/** Whop checkout or sign-up CTA with attribution UTMs + begin_checkout event. */
export function CheckoutLink({
  href,
  plan,
  className,
  children,
  campaignSource,
  campaign,
}: Props) {
  const url = attributedCheckoutHref(href, plan, campaignSource, campaign);
  const external = url.startsWith("http://") || url.startsWith("https://");

  if (external) {
    return (
      <a
        href={url}
        className={className}
        target="_blank"
        rel="noopener noreferrer"
        onClick={() => onCheckoutClick(plan)}
      >
        {children}
      </a>
    );
  }

  return (
    <Link
      href={url}
      className={className}
      prefetch={false}
      onClick={() => onCheckoutClick(plan)}
    >
      {children}
    </Link>
  );
}

/** Auth-aware internal path with campaign UTMs (learn → pricing/sign-up). */
export function AttributedLink({
  href,
  source,
  campaign,
  className,
  children,
}: {
  href: string;
  source: string;
  campaign: string;
  className?: string;
  children: ReactNode;
}) {
  const url = appendAttributionToUrl(href, internalCampaignParams(source, campaign));
  return (
    <Link href={url} className={className} prefetch={false}>
      {children}
    </Link>
  );
}
