"use client";

import Link from "next/link";
import { useWhopCheckout } from "@/hooks/useWhopCheckout";

type Props = {
  variant: "yearly" | "monthly";
  className: string;
  children: React.ReactNode;
};

export function PricingCheckoutLink({ variant, className, children }: Props) {
  const payload = useWhopCheckout();
  const checkout = payload?.checkout;
  const href =
    variant === "yearly"
      ? checkout?.yearly || checkout?.store || "/sign-up"
      : checkout?.monthly || checkout?.store || "/sign-up";
  const external = href.startsWith("http");

  if (!payload) {
    return (
      <span className={className + " pointer-events-none opacity-60"} aria-busy="true">
        {children}
      </span>
    );
  }

  return (
    <Link
      href={href}
      prefetch={false}
      className={className}
      {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
    >
      {children}
    </Link>
  );
}
