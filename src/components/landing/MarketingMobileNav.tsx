"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { NavAuthLinks } from "./NavAuthLinks";

export type MarketingNavLink = {
  href: string;
  label: string;
  iosHide?: boolean;
};

/** Mobile marketing nav — desktop links are hidden below md; this drawer restores full IA. */
export function MarketingMobileNav({
  links,
  signedIn,
}: {
  links: MarketingNavLink[];
  signedIn: boolean;
}) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    document.documentElement.classList.toggle("mkt-menu-open", open);
    return () => document.documentElement.classList.remove("mkt-menu-open");
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  return (
    <>
      <button
        type="button"
        className="mkt-nav-menu-btn hide-in-ios-app"
        aria-expanded={open}
        aria-controls="mkt-mobile-menu"
        aria-label={open ? "Close menu" : "Open menu"}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="mkt-nav-menu-bars" aria-hidden="true">
          <span />
          <span />
          <span />
        </span>
      </button>

      <div
        id="mkt-mobile-menu"
        className={`mkt-mobile-menu${open ? " is-open" : ""}`}
        aria-hidden={!open}
        role="dialog"
        aria-modal="true"
        aria-label="Site menu"
      >
        <nav className="mkt-mobile-menu-nav" aria-label="Mobile marketing">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              prefetch={false}
              className={l.iosHide ? "hide-in-ios-app" : undefined}
              onClick={close}
            >
              {l.label}
            </Link>
          ))}
        </nav>
        <div className="mkt-mobile-menu-auth">
          <NavAuthLinks signedIn={signedIn} />
        </div>
      </div>

      {open ? (
        <button
          type="button"
          className="mkt-mobile-menu-backdrop"
          aria-label="Close menu"
          tabIndex={-1}
          onClick={close}
        />
      ) : null}
    </>
  );
}
