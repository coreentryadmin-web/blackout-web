"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useIosNativeShell } from "@/hooks/useIosNativeShell";
import { getIosToolRouteIndex } from "@/lib/ios-tool-routes";

const SPRING = { type: "spring" as const, stiffness: 420, damping: 38, mass: 0.88 };

type Props = {
  children: React.ReactNode;
};

/**
 * Direction-aware page transitions for the native iOS shell — spring slide + crossfade
 * when switching tools via the tab bar or menu. Web and unsigned routes pass through.
 */
export function IosNativePageTransition({ children }: Props) {
  const path = usePathname();
  const native = useIosNativeShell();
  const reduced = useReducedMotion();
  const prevPath = useRef(path);
  const dirRef = useRef(0);

  if (path !== prevPath.current) {
    const prevIdx = getIosToolRouteIndex(prevPath.current);
    const nextIdx = getIosToolRouteIndex(path);
    dirRef.current =
      prevIdx >= 0 && nextIdx >= 0 && prevIdx !== nextIdx ? (nextIdx > prevIdx ? 1 : -1) : 0;
    prevPath.current = path;
  }

  useEffect(() => {
    if (!native) return;
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
  }, [path, native]);

  if (!native) return <>{children}</>;

  const dir = dirRef.current;
  const offset = reduced ? 0 : dir * 32;

  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={path}
        className="ios-native-page-stage"
        initial={{
          opacity: reduced ? 0.92 : 0,
          x: offset,
          filter: reduced ? "none" : "blur(6px)",
        }}
        animate={{
          opacity: 1,
          x: 0,
          filter: "blur(0px)",
        }}
        exit={{
          opacity: reduced ? 0.92 : 0,
          x: reduced ? 0 : dir * -18,
          filter: reduced ? "none" : "blur(4px)",
        }}
        transition={reduced ? { duration: 0.12 } : SPRING}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}
