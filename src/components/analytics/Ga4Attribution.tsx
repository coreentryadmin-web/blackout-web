"use client";

import { Suspense, useEffect, useRef } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import {
  consumePendingSignUp,
  ga4OncePerSession,
  hasSessionCookie,
  markPendingSignUp,
  trackGa4Event,
  trackGa4PageView,
} from "@/lib/analytics/ga4-client";
import {
  GA4_EVENTS,
  isDeskPath,
  learnArticleSlugFromPath,
} from "@/lib/analytics/ga4-events";
import { trackXEvent } from "@/lib/analytics/x-pixel";
import { captureAttributionFromSearch } from "@/lib/analytics/utm";

function Ga4AttributionInner() {
  const pathname = usePathname() ?? "/";
  const searchParams = useSearchParams();
  const search = searchParams?.toString() ? `?${searchParams.toString()}` : "";
  const lastPath = useRef<string | null>(null);

  useEffect(() => {
    captureAttributionFromSearch(search, pathname);
  }, [pathname, search]);

  useEffect(() => {
    if (pathname === lastPath.current && !search) return;
    lastPath.current = pathname;
    trackGa4PageView(pathname, search);

    if (pathname === "/pricing" && ga4OncePerSession("pricing_view")) {
      trackGa4Event(GA4_EVENTS.pricingView, { page_path: pathname });
    }

    if (pathname === "/sign-up" || pathname.startsWith("/sign-up/")) {
      if (ga4OncePerSession("sign_up_started")) {
        trackGa4Event(GA4_EVENTS.signUpStarted, { page_path: pathname });
      }
      markPendingSignUp();
    }

    if (
      (pathname === "/upgrade" || pathname.startsWith("/upgrade")) &&
      hasSessionCookie() &&
      consumePendingSignUp()
    ) {
      trackGa4Event(GA4_EVENTS.signUp, { page_path: pathname });
      trackXEvent("tw-re1j3-re9z9");
    }

    const articleSlug = learnArticleSlugFromPath(pathname);
    if (articleSlug && ga4OncePerSession(`learn:${articleSlug}`)) {
      trackGa4Event(GA4_EVENTS.learnArticleRead, {
        article_slug: articleSlug,
        page_path: pathname,
      });
    }

    if (isDeskPath(pathname) && hasSessionCookie() && ga4OncePerSession("desk_opened")) {
      trackGa4Event(GA4_EVENTS.deskOpened, { page_path: pathname });
    }
  }, [pathname, search]);

  return null;
}

/** Captures UTMs, SPA pageviews, and top-of-funnel GA4 conversion events. */
export function Ga4Attribution() {
  return (
    <Suspense fallback={null}>
      <Ga4AttributionInner />
    </Suspense>
  );
}
