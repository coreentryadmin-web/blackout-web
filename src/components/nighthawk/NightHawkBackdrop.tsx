"use client";

import Image from "next/image";
import { motion, useReducedMotion } from "framer-motion";
import { IMAGES } from "@/lib/images";

/**
 * Full-screen cinematic backdrop for the Night Hawk desk. Shows the WHOLE night-vision
 * operator portrait uncropped (object-contain), anchored left, with a perpetual
 * "glow / dim" brightness breathe so the green eyes pulse. Reduced-motion users get a
 * static frame. The desk panels are glassy so the operator reads through them.
 */
export function NightHawkBackdrop() {
  const reduced = useReducedMotion();
  return (
    <div className="fixed inset-0 z-0 overflow-hidden pointer-events-none" aria-hidden>
      {/* whole portrait, uncropped, left-anchored — slow brightness "glow / dim" (no zoom) */}
      <motion.div
        className="absolute inset-0"
        animate={
          reduced
            ? { filter: "brightness(1.24) contrast(1.08) saturate(1.14)" }
            : {
                filter: [
                  "brightness(1.12) contrast(1.08) saturate(1.14)",
                  "brightness(1.42) contrast(1.08) saturate(1.14)",
                  "brightness(1.12) contrast(1.08) saturate(1.14)",
                ],
              }
        }
        transition={{ duration: 9, ease: "easeInOut", repeat: Infinity }}
      >
        <Image
          src={IMAGES.nighthawkOperator}
          alt=""
          fill
          priority
          sizes="100vw"
          className="object-contain"
          style={{ objectPosition: "left center" }}
        />
      </motion.div>

      {/* base fade to void so the desk seams cleanly into the page */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "linear-gradient(180deg, transparent 0%, transparent 72%, rgba(4,4,7,0.5) 90%, #040407 100%)",
        }}
      />
    </div>
  );
}
