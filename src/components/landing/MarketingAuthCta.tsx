"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { readClientSignedIn, resolveClientSignedIn } from "@/lib/client-signed-in";

type AuthCtaBase = {
  serverSignedIn: boolean;
  hrefSignedIn: string;
  hrefSignedOut: string;
};

function useHealedSignedIn(serverSignedIn: boolean): boolean {
  const [signedIn, setSignedIn] = useState(() => resolveClientSignedIn(serverSignedIn));

  useEffect(() => {
    const client = readClientSignedIn();
    if (client !== null && client !== signedIn) setSignedIn(client);
  }, [signedIn]);

  return signedIn;
}

/** Auth-aware marketing link — first paint uses __client_uat, not stale SSR chrome. */
export function MarketingAuthCta({
  serverSignedIn,
  hrefSignedIn,
  hrefSignedOut,
  labelSignedIn,
  labelSignedOut,
  className,
  prefetch = false,
  children,
}: AuthCtaBase & {
  labelSignedIn: string;
  labelSignedOut: string;
  className?: string;
  prefetch?: boolean;
  children?: ReactNode | ((signedIn: boolean) => ReactNode);
}) {
  const signedIn = useHealedSignedIn(serverSignedIn);
  const body =
    typeof children === "function" ? children(signedIn) : children ?? (signedIn ? labelSignedIn : labelSignedOut);

  return (
    <Link href={signedIn ? hrefSignedIn : hrefSignedOut} prefetch={prefetch} className={className}>
      {body}
    </Link>
  );
}

/** Text-only heal for labels next to auth CTAs (sticky bar, etc.). */
export function MarketingAuthLabel({
  serverSignedIn,
  signedInLabel,
  signedOutLabel,
}: {
  serverSignedIn: boolean;
  signedInLabel: string;
  signedOutLabel: string;
}) {
  const signedIn = useHealedSignedIn(serverSignedIn);
  return <>{signedIn ? signedInLabel : signedOutLabel}</>;
}

/** Same heal logic for plain anchors (pricing cards, external fallbacks). */
export function MarketingAuthAnchor({
  serverSignedIn,
  hrefSignedIn,
  hrefSignedOut,
  className,
  children,
}: AuthCtaBase & {
  className?: string;
  children: ReactNode;
}) {
  const signedIn = useHealedSignedIn(serverSignedIn);

  return (
    <a href={signedIn ? hrefSignedIn : hrefSignedOut} className={className}>
      {children}
    </a>
  );
}
