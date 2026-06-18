"use client";

import { motion, useScroll, useSpring, useTransform } from "framer-motion";

export function ScrollProgressBar() {
  const { scrollYProgress } = useScroll();
  const scaleX = useSpring(useTransform(scrollYProgress, [0, 1], [0, 1]), {
    stiffness: 120,
    damping: 30,
    restDelta: 0.001,
  });

  return (
    <motion.div
      className="landing-scroll-progress"
      style={{ scaleX, transformOrigin: "0% 50%" }}
      aria-hidden
    />
  );
}
