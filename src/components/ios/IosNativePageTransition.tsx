"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useIosNativeShell } from "@/hooks/useIosNativeShell";
import { getIosRouteKey, getIosToolRouteIndex } from "@/lib/ios-tool-routes";

const SPRING = { type: "spring" as const, stiffness: 520, damping: 42, mass: 0.72 };
const FADE = { duration: 0.16, ease: [0.22, 1, 0.36, 1] as const };

type Props = {
  children: React.ReactNode;
};

/**
 * Direction-aware page transitions for the native iOS shell — spring slide between
 * tab tools; soft fade for utility routes (account, learn, FAQ, admin).
 */
export function IosNativePageTransition({ children }: Props) {
  const path = usePathname();
  const native = useIosNativeShell();
  const reduced = useReducedMotion();
  const prevPath = useRef(path);
  const dirRef = useRef(0);
  const utilityRef = useRef(false);

  if (path !== prevPath.current) {
    const prevIdx = getIosToolRouteIndex(prevPath.current);
    const nextIdx = getIosToolRouteIndex(path);
    const prevTool = prevIdx >= 0;
    const nextTool = nextIdx >= 0;
    dirRef.current =
      prevTool && nextTool && prevIdx !== nextIdx ? (nextIdx > prevIdx ? 1 : -1) : 0;
    utilityRef.current = !nextTool || !prevTool || prevIdx < 0 || nextIdx < 0;
    prevPath.current = path;
  }

  useEffect(() => {
    if (!native) return;
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
  }, [path, native]);

  if (!native) return <>{children}</>;

  const dir = dirRef.current;
  const utility = utilityRef.current || getIosToolRouteIndex(path) < 0;
  const offset = reduced || utility ? 0 : dir * 24;

  // WKWebView can stick on opacity:0/blur initial states during fast tab switches —
  // keep tool routes opaque so desks never flash blank between instrument-rail taps.
  return (
    <AnimatePresence mode="sync" initial={false}>
      <motion.div
        key={path}
        className="ios-native-page-stage"
        initial={{
          opacity: 1,
          x: offset,
          y: 0,
          filter: "none",
        }}
        animate={{
          opacity: 1,
          x: 0,
          y: 0,
          filter: "none",
        }}
        exit={{
          opacity: utility ? 0.92 : 0.85,
          x: reduced || utility ? 0 : dir * -14,
          y: 0,
          filter: "none",
        }}
        transition={reduced ? { duration: 0.1 } : utility ? FADE : SPRING}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}
