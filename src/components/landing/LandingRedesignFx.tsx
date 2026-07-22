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

    // 4. hero GEX-wall canvas
    const cv = document.getElementById("rl-gex") as HTMLCanvasElement | null;
    if (cv) {
      const ctx = cv.getContext("2d");
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      let W = 0, H = 0, raf = 0, t = 0;
      const rows = [
        { y: 0.16, c: "#00e676", str: 0.95, tier: 1 }, { y: 0.27, c: "#00e676", str: 0.6, tier: 0.7 },
        { y: 0.4, c: "#22d3ee", str: 0.42, tier: 0.5 }, { y: 0.5, c: "#7c5cff", str: 0.7, tier: 0.85, flip: true },
        { y: 0.63, c: "#bf5fff", str: 0.8, tier: 0.9 }, { y: 0.78, c: "#bf5fff", str: 0.5, tier: 0.6 },
        { y: 0.88, c: "#ffd23f", str: 0.35, tier: 0.45 },
      ] as { y: number; c: string; str: number; tier: number; flip?: boolean }[];
      const hex = (c: string, a: number) => { const n = parseInt(c.slice(1), 16); return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`; };
      const size = () => {
        const r = cv.getBoundingClientRect(); W = r.width; H = r.height;
        cv.width = W * dpr; cv.height = H * dpr; ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
      };
      size();
      const onResize = () => size();
      window.addEventListener("resize", onResize);
      const frame = () => {
        if (!ctx) return;
        ctx.clearRect(0, 0, W, H);
        rows.forEach((r) => {
          const y = r.y * H;
          ctx.strokeStyle = hex(r.c, 0.05); ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
          if (r.flip) { ctx.setLineDash([6, 6]); ctx.strokeStyle = hex(r.c, 0.35); ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); ctx.setLineDash([]); }
        });
        const cols = 46, gap = W / cols;
        for (let ci = 0; ci < cols; ci++) {
          const x = ci * gap + gap * 0.5 + ((t * 0.35) % gap);
          rows.forEach((r, ri) => {
            const phase = Math.sin(ci * 0.5 + ri * 1.3 + t * 0.02) * 0.5 + 0.5;
            const mag = r.str * (0.35 + phase * 0.75);
            if (mag < 0.18) return;
            const y = r.y * H, rad = 1.6 + mag * 4.2, life = ci / cols;
            const coreA = Math.min(1, mag) * (0.25 + life * 0.65);
            const ringA = coreA * (r.tier > 0.75 ? 1.25 : r.tier > 0.5 ? 0.7 : 0.28);
            ctx.beginPath(); ctx.fillStyle = hex(r.c, Math.min(0.5, ringA * 0.5)); ctx.arc(x, y, rad * 1.9, 0, 6.28); ctx.fill();
            ctx.beginPath(); ctx.fillStyle = hex(r.c, coreA); ctx.arc(x, y, rad, 0, 6.28); ctx.fill();
          });
        }
        const sx = W * (0.5 + Math.sin(t * 0.01) * 0.02);
        ctx.strokeStyle = hex("#ffffff", 0.08); ctx.beginPath(); ctx.moveTo(sx, 0); ctx.lineTo(sx, H); ctx.stroke();
        t++;
        if (!reduce) raf = requestAnimationFrame(frame);
      };
      frame();
      cleanups.push(() => { cancelAnimationFrame(raf); window.removeEventListener("resize", onResize); });
    }

    // (Per-product deep-dive visuals now use real product screenshots — no canvas mocks.)

    return () => cleanups.forEach((fn) => fn());
  }, []);

  return null;
}
