"use client";

import { clsx } from "clsx";
import type { ReactNode } from "react";

export function LegacyDetailSection({
  title,
  children,
  className,
}: {
  title: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={clsx("legacy-detail-section", className)}>
      <h3 className="legacy-detail-section-title">{title}</h3>
      {children}
    </section>
  );
}

export function LegacyDetailBullets({ children, className }: { children: ReactNode; className?: string }) {
  return <ul className={clsx("legacy-detail-bullets", className)}>{children}</ul>;
}

export function LegacyDetailBullet({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: "up" | "down" | "warn" | "muted";
}) {
  return (
    <li className="legacy-detail-bullet">
      <span className="legacy-detail-bullet-label">{label}</span>
      <span className={clsx("legacy-detail-bullet-value", tone && `is-${tone}`)}>{value}</span>
      {sub ? <span className="legacy-detail-bullet-sub">{sub}</span> : null}
    </li>
  );
}

export function LegacyDetailProse({ children }: { children: ReactNode }) {
  return <p className="legacy-detail-prose">{children}</p>;
}
