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

    // 5. per-product deep-dive visuals — one static mock per module, drawn once (+ redraw on resize).
    const hx = (c: string, a: number) => { const n = parseInt(c.slice(1), 16); return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`; };
    const drawPviz = (cv: HTMLCanvasElement) => {
      const kind = cv.dataset.pviz || "";
      const a = cv.dataset.a || "#00e676";
      const ctx = cv.getContext("2d");
      if (!ctx) return;
      const r = cv.parentElement?.getBoundingClientRect();
      const W = (r?.width || 320), H = Math.max(160, (r?.height || 200) - 40);
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      cv.width = W * dpr; cv.height = H * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      const rng = (s: number) => { let x = Math.sin(s) * 1e4; return x - Math.floor(x); };
      if (kind === "spx") { // GEX ladder
        const rows = 7; for (let i = 0; i < rows; i++) { const y = 14 + i * ((H - 28) / rows); const w = (0.25 + rng(i + 1) * 0.7) * (W - 90); const c = i < 3 ? a : i === 3 ? "#7c5cff" : "#bf5fff"; ctx.fillStyle = hx(c, 0.14); ctx.fillRect(60, y, W - 90, 9); ctx.fillStyle = hx(c, 0.9); ctx.fillRect(60, y, w, 9); ctx.fillStyle = hx("#9AA7B6", 1); ctx.font = "10px ui-monospace"; ctx.fillText(String(7585 - i * 30), 8, y + 9); }
      } else if (kind === "helix") { // flow bars
        const n = 40; for (let i = 0; i < n; i++) { const x = 10 + i * ((W - 20) / n); const h = rng(i * 3.1) * (H - 30) + 6; const up = rng(i) > 0.4; ctx.fillStyle = hx(up ? a : "#ff4d57", rng(i * 2) > 0.6 ? 0.95 : 0.5); ctx.fillRect(x, H - 12 - h, ((W - 20) / n) - 2, h); }
      } else if (kind === "thermal") { // heatmap grid
        const cols = 12, rowsN = 6, cw = W / cols, ch = (H - 8) / rowsN; for (let y = 0; y < rowsN; y++) for (let x = 0; x < cols; x++) { ctx.globalAlpha = rng(x * 7 + y * 13) * 0.9 + 0.08; ctx.fillStyle = a; ctx.fillRect(x * cw + 1, y * ch + 4, cw - 2, ch - 2); } ctx.globalAlpha = 1;
      } else if (kind === "largo") { // AI concentric + nodes
        const cx = W / 2, cy = H / 2; ctx.globalAlpha = 0.5; ctx.strokeStyle = a; for (let i = 1; i <= 5; i++) { ctx.beginPath(); ctx.arc(cx, cy, i * 11, 0, 6.28); ctx.stroke(); } ctx.globalAlpha = 1; ctx.fillStyle = a; ctx.beginPath(); ctx.arc(cx, cy, 5, 0, 6.28); ctx.fill(); for (let i = 0; i < 6; i++) { const an = i * 1.05, d = 22 + rng(i) * 40; ctx.beginPath(); ctx.arc(cx + Math.cos(an) * d, cy + Math.sin(an) * d, 3, 0, 6.28); ctx.fill(); }
      } else if (kind === "hawk") { // A-F grade cards
        const grades = ["A", "A-", "B+", "A", "B"]; grades.forEach((g, i) => { const x = 12 + i * ((W - 24) / grades.length); const w = ((W - 24) / grades.length) - 8; ctx.strokeStyle = hx(a, 0.5); ctx.strokeRect(x, H / 2 - 26, w, 52); ctx.fillStyle = a; ctx.font = "700 22px system-ui"; ctx.fillText(g, x + 10, H / 2 + 6); });
      } else { // vector radar
        const cx = W / 2, cy = H / 2; ctx.strokeStyle = hx(a, 0.35); for (let i = 1; i <= 3; i++) { ctx.beginPath(); ctx.arc(cx, cy, i * (H / 8), 0, 6.28); ctx.stroke(); } ctx.fillStyle = a; for (let i = 0; i < 9; i++) { const an = rng(i) * 6.28, d = rng(i + 5) * (H / 2.4); ctx.globalAlpha = 0.5 + rng(i * 2) * 0.5; ctx.beginPath(); ctx.arc(cx + Math.cos(an) * d, cy + Math.sin(an) * d, 2.5, 0, 6.28); ctx.fill(); } ctx.globalAlpha = 1;
      }
    };
    const pvizEls = Array.from(document.querySelectorAll<HTMLCanvasElement>("canvas[data-pviz]"));
    if (pvizEls.length) {
      const drawAll = () => pvizEls.forEach(drawPviz);
      // draw once visible so the parent has layout dimensions
      const pio = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { drawPviz(e.target as HTMLCanvasElement); pio.unobserve(e.target); } }), { threshold: 0.1 });
      pvizEls.forEach((el) => pio.observe(el));
      window.addEventListener("resize", drawAll);
      cleanups.push(() => { pio.disconnect(); window.removeEventListener("resize", drawAll); });
    }

    return () => cleanups.forEach((fn) => fn());
  }, []);

  return null;
}
