"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { useAppAuth } from "@/lib/auth-client";
import { clsx } from "clsx";
import { ProductMark } from "@/components/marks/ProductMark";
import { isIosAppShell, isIosNativeEmbed } from "@/lib/ios-app-shell";
import { IOS_TOOLS, isIosToolRoute } from "@/lib/ios-tool-routes";
import { IOS_TAB_RAIL, isIosTabRailActive } from "@/lib/ios-tab-rail";
import { toolKeyForHref, type ToolKey } from "@/lib/tool-access";
import { iosHapticSelection } from "@/lib/ios-haptics";

const TAB_SPRING = { type: "spring" as const, stiffness: 520, damping: 42 };

/** Instrument rail — terminal-style bottom switcher (not a floating pill tab bar). */
export function IosAppTabBar({ lockedTools = [] }: { lockedTools?: ToolKey[] }) {
  const path = usePathname();
  const { isSignedIn, isLoaded } = useAppAuth();
  const [iosApp, setIosApp] = useState(false);
  const [nativeEmbed, setNativeEmbed] = useState(false);

  useEffect(() => {
    setIosApp(isIosAppShell());
    setNativeEmbed(isIosNativeEmbed());
  }, []);

  const visible =
    iosApp &&
    !nativeEmbed &&
    isLoaded &&
    isSignedIn &&
    isIosToolRoute(path);
  useEffect(() => {
    document.documentElement.classList.toggle("ios-tab-bar", visible);
    return () => document.documentElement.classList.remove("ios-tab-bar");
  }, [visible]);

  if (!visible) return null;

  return (
    <nav className="ios-app-tab-bar" aria-label="Instrument rail">
      <ul className="ios-app-tab-list">
        {IOS_TAB_RAIL.map((tab) => {
          const active = isIosTabRailActive(tab, path);
          const key = toolKeyForHref(tab.href);
          const locked = key != null && lockedTools.includes(key);
          return (
            <li key={tab.href} className="ios-app-tab-li">
              {active && (
                <>
                  <motion.span
                    layoutId="ios-native-tab-indicator"
                    className="ios-app-tab-indicator"
                    style={{ "--tab-accent": tab.accent } as React.CSSProperties}
                    transition={TAB_SPRING}
                    aria-hidden
                  />
                  <motion.span
                    layoutId="ios-native-tab-underline"
                    className="ios-app-tab-underline"
                    style={{ "--tab-accent": tab.accent } as React.CSSProperties}
                    transition={TAB_SPRING}
                    aria-hidden
                  />
                </>
              )}
              <Link
                href={tab.href}
                prefetch={null}
                scroll={false}
                onClick={() => {
                  if (!active) iosHapticSelection();
                  window.dispatchEvent(new Event("blackout:route-pending"));
                }}
                className={clsx(
                  "ios-app-tab-link",
                  active && "ios-app-tab-link-active",
                  !active && "ios-app-tab-link-inactive",
                  locked && "ios-app-tab-link-locked"
                )}
                style={{ "--tab-accent": tab.accent } as React.CSSProperties}
                aria-current={active ? "page" : undefined}
                aria-label={tab.label}
              >
                <span className="ios-app-tab-icon-wrap">
                  <ProductMark product={tab.mark} size={active ? 20 : 18} title={tab.label} className="ios-app-tab-icon" />
                </span>
                <span className="ios-app-tab-label">{tab.short}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
