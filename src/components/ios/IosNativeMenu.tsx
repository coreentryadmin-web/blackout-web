"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { clsx } from "clsx";
import { IOS_TOOLS } from "@/lib/ios-tool-routes";
import { ProductMark } from "@/components/marks/ProductMark";
import { PushNotificationToggle } from "@/components/PushNotificationToggle";
import { toolKeyForHref, type ToolKey } from "@/lib/tool-access";

type Props = {
  open: boolean;
  onClose: () => void;
  lockedTools?: ToolKey[];
  showAdmin?: boolean;
};

export function IosNativeMenu({ open, onClose, lockedTools = [], showAdmin }: Props) {
  const path = usePathname();

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.button
            type="button"
            className="ios-native-menu-scrim"
            aria-label="Close menu"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label="BlackOut menu"
            className="ios-native-menu-sheet outline-none"
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", stiffness: 420, damping: 36 }}
          >
            <div className="ios-native-menu-handle" aria-hidden />
            <p className="ios-native-menu-kicker font-mono">BlackOut · Mobile desk</p>

            <div className="ios-native-menu-grid">
              {IOS_TOOLS.map((tool) => {
                const key = toolKeyForHref(tool.href);
                const locked = key != null && lockedTools.includes(key);
                const active = path === tool.href || path.startsWith(`${tool.href}/`);
                return (
                  <Link
                    key={tool.href}
                    href={tool.href}
                    prefetch={false}
                    onClick={onClose}
                    className={clsx(
                      "ios-native-menu-tool",
                      active && "ios-native-menu-tool-active",
                      locked && "ios-native-menu-tool-locked"
                    )}
                    style={{ "--tool-accent": tool.accent } as React.CSSProperties}
                  >
                    <ProductMark product={tool.mark} size={32} title={tool.label} />
                    <span className="ios-native-menu-tool-label font-syne">{tool.short}</span>
                    <span className="ios-native-menu-tool-sub font-mono">{tool.tagline}</span>
                  </Link>
                );
              })}
            </div>

            <div className="ios-native-menu-links">
              <Link href="/account" onClick={onClose} className="ios-native-menu-link font-syne">
                Account
              </Link>
              <Link href="/faq" onClick={onClose} className="ios-native-menu-link font-syne">
                FAQ
              </Link>
              <Link href="/learn" onClick={onClose} className="ios-native-menu-link font-syne">
                Learn
              </Link>
              {showAdmin && (
                <Link href="/admin" onClick={onClose} className="ios-native-menu-link font-syne text-bear">
                  Admin
                </Link>
              )}
            </div>

            <div className="ios-native-menu-footer">
              <PushNotificationToggle />
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
