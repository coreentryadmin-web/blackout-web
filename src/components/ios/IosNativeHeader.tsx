"use client";

import { UserButton } from "@clerk/nextjs";
import { AnimatePresence, motion } from "framer-motion";
import { getIosToolMeta } from "@/lib/ios-tool-routes";
import { ProductMark } from "@/components/marks/ProductMark";

const CLERK_APPEARANCE = {
  variables: {
    colorBackground: "#040407",
    colorText: "#f4f6fb",
    colorTextSecondary: "#9fb4d4",
    colorPrimary: "#00e676",
    colorNeutral: "rgba(255,255,255,0.16)",
    borderRadius: "12px",
  },
  elements: {
    avatarBox: "w-9 h-9 ring-1 ring-bull/40",
    userButtonPopoverCard: "!bg-[#040407] border border-white/10 shadow-[0_8px_40px_-8px_rgba(0,0,0,0.9)]",
    userButtonPopoverActionButton: "text-sky-200 hover:text-white hover:!bg-white/5",
    userButtonPopoverActionButtonText: "text-sky-200",
    userButtonPopoverFooter: "!bg-[#040407] border-t border-white/8",
  },
} as const;

const TITLE_SPRING = { type: "spring" as const, stiffness: 500, damping: 38 };

type Props = {
  path: string;
  onMenuOpen: () => void;
};

export function IosNativeHeader({ path, onMenuOpen }: Props) {
  const tool = getIosToolMeta(path);
  const title = tool?.label ?? "BlackOut";
  const accent = tool?.accent ?? "#00e676";
  const titleKey = tool?.href ?? path;

  return (
    <header className="ios-native-header" role="banner">
      <div className="ios-native-header-inner">
        <button
          type="button"
          className="ios-native-icon-btn"
          aria-label="Open menu"
          onClick={onMenuOpen}
        >
          <span className="ios-native-menu-glyph" aria-hidden>
            <span />
            <span />
            <span />
          </span>
        </button>

        <div className="ios-native-header-title">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={titleKey}
              className="ios-native-header-title-inner"
              initial={{ opacity: 0, y: 8, filter: "blur(4px)" }}
              animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
              exit={{ opacity: 0, y: -6, filter: "blur(3px)" }}
              transition={TITLE_SPRING}
            >
              {tool ? (
                <ProductMark product={tool.mark} size={20} title={tool.label} className="shrink-0" />
              ) : (
                <span className="ios-native-brand-dot" aria-hidden style={{ background: accent }} />
              )}
              <span className="font-syne text-[15px] font-bold tracking-[0.02em] text-white truncate">
                {title}
              </span>
            </motion.div>
          </AnimatePresence>
        </div>

        <div className="ios-native-header-actions">
          <UserButton appearance={CLERK_APPEARANCE} userProfileUrl="/account" />
        </div>
      </div>
      <motion.div
        className="ios-native-header-accent"
        aria-hidden
        animate={{
          background: `linear-gradient(90deg, transparent, ${accent}, transparent)`,
        }}
        transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
      />
    </header>
  );
}
