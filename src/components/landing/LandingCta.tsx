"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { clsx } from "clsx";

type LandingCtaProps = {
  href: string;
  children: React.ReactNode;
  variant?: "primary" | "ghost" | "outline";
  className?: string;
  external?: boolean;
};

const tap = { scale: 0.97 };
const hoverPrimary = { scale: 1.03 };
const hoverGhost = { scale: 1.02 };

export function LandingCta({
  href,
  children,
  variant = "primary",
  className,
  external,
}: LandingCtaProps) {
  const classes = clsx(
    variant === "primary" && "btn-primary landing-btn-primary",
    variant === "ghost" && "btn-ghost landing-btn-ghost",
    variant === "outline" && "btn-outline landing-btn-outline",
    className
  );

  const inner = external ? (
    <a href={href} target="_blank" rel="noopener noreferrer" className={classes}>
      {children}
    </a>
  ) : (
    <Link href={href} className={classes}>
      {children}
    </Link>
  );

  return (
    <motion.span
      className={clsx("inline-flex", className?.includes("w-full") && "w-full")}
      whileTap={tap}
      whileHover={variant === "primary" ? hoverPrimary : hoverGhost}
    >
      {inner}
    </motion.span>
  );
}
