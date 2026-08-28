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

  /** Same-page hash links (/#protocol, /#modules) — Next client nav often drops the fragment. */
  const onHashNavClick = useCallback(
    (href: string) => (e: React.MouseEvent<HTMLAnchorElement>) => {
      close();
      const hashIdx = href.indexOf("#");
      if (hashIdx === -1) return;
      const hash = href.slice(hashIdx);
      const pathPart = href.slice(0, hashIdx);
      const isHomeHash = hash.startsWith("#") && (pathPart === "" || pathPart === "/");
      if (!isHomeHash || typeof window === "undefined" || window.location.pathname !== "/") return;
      e.preventDefault();
      const id = hash.slice(1);
      document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
      history.replaceState(null, "", `${window.location.pathname}${window.location.search}${hash}`);
    },
    [close],
  );

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

  // Keep keyboard focus inside the drawer while open.
  useEffect(() => {
    if (!open) return;
    const menu = document.getElementById("mkt-mobile-menu");
    const btn = document.querySelector<HTMLButtonElement>(".mkt-nav-menu-btn");
    const focusables = menu?.querySelectorAll<HTMLElement>(
      'a[href], button:not([tabindex="-1"])',
    );
    focusables?.[0]?.focus();
    const onTab = (e: KeyboardEvent) => {
      if (e.key !== "Tab" || !focusables?.length) return;
      const list = Array.from(focusables);
      const first = list[0];
      const last = list[list.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onTab);
    return () => {
      document.removeEventListener("keydown", onTab);
      btn?.focus();
    };
  }, [open]);

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
              onClick={onHashNavClick(l.href)}
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
