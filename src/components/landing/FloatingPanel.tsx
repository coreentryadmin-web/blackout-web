"use client";

import { motion, type HTMLMotionProps } from "framer-motion";
import { clsx } from "clsx";

const floatTransition = {
  duration: 4,
  repeat: Infinity,
  ease: "easeInOut" as const,
};

type FloatingPanelProps = HTMLMotionProps<"div"> & {
  /** Scroll-reveal axis — kept on the outer wrapper only. */
  revealX?: number;
  revealDelay?: number;
};

/**
 * Two-layer motion wrapper: outer handles scroll-reveal (x/opacity),
 * inner handles ambient float (y) so transforms never conflict.
 */
export function FloatingPanel({
  children,
  className,
  revealX = 0,
  revealDelay = 0,
  ...rest
}: FloatingPanelProps) {
  return (
    <motion.div
      initial={{ opacity: 0, x: revealX }}
      whileInView={{ opacity: 1, x: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.65, delay: revealDelay, ease: [0.22, 1, 0.36, 1] }}
      className={className}
      {...rest}
    >
      <motion.div
        animate={{ y: [0, -12, 0] }}
        transition={floatTransition}
        className="relative w-full h-full"
      >
        {children}
      </motion.div>
    </motion.div>
  );
}

export function ScrollRevealPanel({
  children,
  className,
  revealX = 0,
  revealDelay = 0,
}: {
  children: React.ReactNode;
  className?: string;
  revealX?: number;
  revealDelay?: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, x: revealX }}
      whileInView={{ opacity: 1, x: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.65, delay: revealDelay, ease: [0.22, 1, 0.36, 1] }}
      className={clsx(className)}
    >
      {children}
    </motion.div>
  );
}
