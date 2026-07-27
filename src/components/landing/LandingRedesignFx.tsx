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

    // 5. Energy ring — cursor-tracking conic-gradient border on product cards + glass cards
    if (!reduce) {
      const targets = document.querySelectorAll<HTMLElement>(".rl-pcard, .rl-glass");
      const state = new Map<HTMLElement, { mx: number; my: number; angle: number; active: boolean; raf: number | null }>();

      function tick(card: HTMLElement) {
        const s = state.get(card)!;
        if (!s.active) { s.raf = null; return; }

        const cx = s.mx - 0.5;
        const cy = s.my - 0.5;
        const target = Math.atan2(cy, cx) * (180 / Math.PI) + 90;

        let diff = target - s.angle;
        while (diff > 180) diff -= 360;
        while (diff < -180) diff += 360;
        s.angle += diff * 0.12;

        card.style.setProperty("--mx", (s.mx * 100).toFixed(1) + "%");
        card.style.setProperty("--my", (s.my * 100).toFixed(1) + "%");
        card.style.setProperty("--ring-angle", s.angle.toFixed(1) + "deg");

        s.raf = requestAnimationFrame(() => tick(card));
      }

      targets.forEach((card) => {
        state.set(card, { mx: 0.5, my: 0.5, angle: 0, active: false, raf: null });

        const onEnter = () => { const s = state.get(card)!; s.active = true; if (!s.raf) tick(card); };
        const onLeave = () => { const s = state.get(card)!; s.active = false; };
        const onMove = (e: MouseEvent) => {
          const rect = card.getBoundingClientRect();
          const s = state.get(card)!;
          s.mx = (e.clientX - rect.left) / rect.width;
          s.my = (e.clientY - rect.top) / rect.height;
        };

        card.addEventListener("mouseenter", onEnter);
        card.addEventListener("mouseleave", onLeave);
        card.addEventListener("mousemove", onMove);

        cleanups.push(() => {
          card.removeEventListener("mouseenter", onEnter);
          card.removeEventListener("mouseleave", onLeave);
          card.removeEventListener("mousemove", onMove);
          const s = state.get(card);
          if (s?.raf) cancelAnimationFrame(s.raf);
        });
      });
    }

    return () => cleanups.forEach((fn) => fn());
  }, []);

  return null;
}
