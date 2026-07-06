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

const SHEET_SPRING = { type: "spring" as const, stiffness: 440, damping: 38 };
const GRID_STAGGER = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.04, delayChildren: 0.06 },
  },
};
const GRID_ITEM = {
  hidden: { opacity: 0, y: 14, scale: 0.96 },
  show: { opacity: 1, y: 0, scale: 1, transition: { type: "spring" as const, stiffness: 480, damping: 32 } },
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
            transition={{ duration: 0.2 }}
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
            transition={SHEET_SPRING}
          >
            <div className="ios-native-menu-handle" aria-hidden />
            <p className="ios-native-menu-kicker font-mono">BlackOut · Mobile desk</p>

            <motion.div
              className="ios-native-menu-grid"
              variants={GRID_STAGGER}
              initial="hidden"
              animate="show"
            >
              {IOS_TOOLS.map((tool) => {
                const key = toolKeyForHref(tool.href);
                const locked = key != null && lockedTools.includes(key);
                const active = path === tool.href || path.startsWith(`${tool.href}/`);
                return (
                  <motion.div key={tool.href} variants={GRID_ITEM}>
                    <Link
                      href={tool.href}
                      prefetch={false}
                      scroll={false}
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
                  </motion.div>
                );
              })}
            </motion.div>

            <div className="ios-native-menu-links">
              <Link href="/account" scroll={false} onClick={onClose} className="ios-native-menu-link font-syne">
                Account
              </Link>
              <Link href="/faq" scroll={false} onClick={onClose} className="ios-native-menu-link font-syne">
                FAQ
              </Link>
              <Link href="/learn" scroll={false} onClick={onClose} className="ios-native-menu-link font-syne">
                Learn
              </Link>
              {showAdmin && (
                <Link href="/admin" scroll={false} onClick={onClose} className="ios-native-menu-link font-syne text-bear">
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
