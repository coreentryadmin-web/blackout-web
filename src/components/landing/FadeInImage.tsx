"use client";

import Image, { type ImageProps } from "next/image";
import { useState } from "react";
import { motion } from "framer-motion";
import { clsx } from "clsx";

export function FadeInImage({ className, alt, fill, ...props }: ImageProps) {
  const [loaded, setLoaded] = useState(false);

  return (
    <motion.div
      className={clsx(fill && "absolute inset-0", "overflow-hidden", className)}
      initial={{ opacity: 0 }}
      animate={{ opacity: loaded ? 1 : 0 }}
      transition={{ duration: 0.6, ease: "easeOut" }}
    >
      <Image
        {...props}
        alt={alt}
        fill={fill}
        loading="lazy"
        onLoad={() => setLoaded(true)}
        className={fill ? "object-cover" : undefined}
      />
    </motion.div>
  );
}
