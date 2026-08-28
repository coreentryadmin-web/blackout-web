"use client";

import Link from "next/link";
import type { ComponentProps } from "react";
import { handleMarketingHomeHashClick } from "@/lib/marketing-hash-nav";

/** In-page homepage anchor — reliable hash + scroll on `/` (hero CTAs, etc.). */
export function MarketingHashLink({
  href,
  onClick,
  ...rest
}: ComponentProps<typeof Link>) {
  const hashHandler = typeof href === "string" ? handleMarketingHomeHashClick(href) : undefined;
  return (
    <Link
      href={href}
      prefetch={false}
      {...rest}
      onClick={(e) => {
        hashHandler?.(e);
        onClick?.(e);
      }}
    />
  );
}
