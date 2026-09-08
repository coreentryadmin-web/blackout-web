"use client";

import { useEffect, useState } from "react";

/** True when viewport is at or below the vector board mobile split breakpoint. */
export function useVectorBoardMobile(breakpointPx = 820): boolean {
  const [mobile, setMobile] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${breakpointPx}px)`);
    const update = () => setMobile(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, [breakpointPx]);

  return mobile;
}
