"use client";

import { useEffect } from "react";

/**
 * Progressive-enhancement layer for the redesigned homepage. The content is fully
 * server-rendered; this only animates it: scroll-reveal, the ticker tape, a live desk
 * jitter, and the signature hero GEX-wall canvas (walls forming/fading beads whose halo
 * ring = integrity — the same wall-integrity feature shipped in the product). All effects
 * are guarded by prefers-reduced-motion and torn down on unmount.
 */
export function LandingRedesignFx() {
  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const cleanups: Array<() => void> = [];

    // 1. scroll reveal
    const io = new IntersectionObserver(
      (es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add("rl-in"); io.unobserve(e.target); } }),
      { threshold: 0.15 }
    );
    document.querySelectorAll(".rl-reveal:not(.rl-in)").forEach((el) => io.observe(el));
    cleanups.push(() => io.disconnect());

    // 2. ticker tape
    const tape = document.getElementById("rl-tape");
    if (tape) {
      const TP: [string, string, string, string][] = [
        ["SPX", "6472.15", "up", "+0.42%"], ["SWEEP", "SPY 645C ×4,200", "tk", ""],
        ["GEX FLIP", "6455", "tk", ""], ["NVDA", "178.20", "dn", "-1.1%"],
        ["BLOCK", "QQQ 470P ×1,800", "tk", ""], ["VIX", "14.8", "dn", "-3.2%"],
        ["KING", "SPX 6500C", "up", ""], ["ASTS", "41.66", "up", "+2.8%"],
        ["CHARM", "rotating ↑", "tk", ""], ["MAX PAIN", "6480", "tk", ""],
      ];
      const seg = TP.map((t) => `<span><span class="tk">${t[0]}</span> <span class="${t[2]}">${t[1]} ${t[3]}</span></span>`).join("");
      tape.innerHTML = seg + seg;
    }

    // 3. desk spot jitter
    const spot = document.getElementById("rl-spot");
    let jitter: ReturnType<typeof setInterval> | undefined;
    if (spot && !reduce) {
      jitter = setInterval(() => { spot.textContent = (6472.15 + (Math.random() - 0.5) * 0.9).toFixed(2); }, 1400);
      cleanups.push(() => clearInterval(jitter));
    }

    // 4. (Hero background is now the WebGL <DealersLadderBackground /> — the flat 2D
    //     GEX-wall canvas that used to live here was retired in favour of the shader.)

    // (Per-product deep-dive visuals now use real product screenshots — no canvas mocks.)

    return () => cleanups.forEach((fn) => fn());
  }, []);

  return null;
}
