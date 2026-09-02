"use client";

import { useEffect } from "react";
import { mobileStickyBlockedByContent, shouldShowMobileStickyCta } from "@/lib/marketing/mobile-sticky-cta";

export function LandingRedesignFx() {
  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      // Reduced motion correctly skips every animation below (canvas atmosphere, scroll
      // reveals, parallax). The "Intelligence Pipeline" stage badges render a static,
      // always-true semantic label (SCAN/VERIFY/STRUCTURE/LOGGED) directly in the server-
      // rendered markup (RedesignHome.tsx) — no runtime text mutation needed here or in the
      // IntersectionObserver below. This used to swap an OFFLINE default to ONLINE on
      // scroll-into-view, which meant a reduced-motion browser (an accessibility setting, or
      // a crawler/audit tool that defaults to it) never fired the observer and saw all four
      // stages stuck at OFFLINE forever, reading as the platform being down while the rest of
      // the page markets it as live. Still mark the stages "lit"/"is-live" for the CSS glow,
      // purely decorative now.
      document.querySelectorAll<HTMLElement>("[data-pipe-stage]").forEach((el) => {
        el.classList.add("pipe-lit");
        el.querySelector(".pipe-status")?.classList.add("is-live");
      });
      document.querySelectorAll<HTMLElement>("[data-pipe-conduit]").forEach((el) => {
        el.classList.add("pipe-lit");
      });
      return;
    }

    const cleanups: Array<() => void> = [];
    let destroyed = false;

    // ── Global atmosphere canvas ──
    const atC = document.getElementById("atmos") as HTMLCanvasElement | null;
    if (atC) {
      const atx = atC.getContext("2d");
      if (atx) {
        let W = 0,
          H = 0;
        function resize() {
          W = atC!.width = innerWidth;
          H = atC!.height = innerHeight;
        }
        resize();
        const resizeHandler = () => resize();
        window.addEventListener("resize", resizeHandler);
        cleanups.push(() => window.removeEventListener("resize", resizeHandler));

        const particleCount = innerWidth < 768 ? 32 : 80;
        const particles = Array.from({ length: particleCount }, () => ({
          x: Math.random() * innerWidth,
          y: Math.random() * innerHeight,
          vx: (Math.random() - 0.5) * 0.15,
          vy: (Math.random() - 0.5) * 0.12,
          r: Math.random() * 1.2 + 0.3,
          a: Math.random() * 0.25 + 0.05,
        }));
        const traces = Array.from({ length: 12 }, () => ({
          y: Math.random() * innerHeight,
          speed: Math.random() * 0.3 + 0.08,
          len: Math.random() * 120 + 40,
          x: Math.random() * innerWidth,
          a: Math.random() * 0.04 + 0.01,
        }));
        const conduits = Array.from({ length: 3 }, (_, i) => ({
          x: innerWidth * ((i + 1) / 4),
          pulse: 0,
          speed: 0.003 + Math.random() * 0.002,
        }));

        let atmosRaf = 0;
        function drawAtmos(t: number) {
          if (destroyed) return;
          atx!.clearRect(0, 0, W, H);
          for (const p of particles) {
            p.x += p.vx;
            p.y += p.vy;
            if (p.x < 0) p.x = W;
            if (p.x > W) p.x = 0;
            if (p.y < 0) p.y = H;
            if (p.y > H) p.y = 0;
            atx!.beginPath();
            atx!.arc(p.x, p.y, p.r, 0, Math.PI * 2);
            atx!.fillStyle = `rgba(163,230,53,${p.a})`;
            atx!.fill();
          }
          for (const tr of traces) {
            tr.x += tr.speed;
            if (tr.x > W + tr.len) tr.x = -tr.len;
            const g = atx!.createLinearGradient(tr.x, 0, tr.x + tr.len, 0);
            g.addColorStop(0, "transparent");
            g.addColorStop(0.5, `rgba(163,230,53,${tr.a})`);
            g.addColorStop(1, "transparent");
            atx!.strokeStyle = g;
            atx!.lineWidth = 0.5;
            atx!.beginPath();
            atx!.moveTo(tr.x, tr.y);
            atx!.lineTo(tr.x + tr.len, tr.y);
            atx!.stroke();
          }
          for (const c of conduits) {
            c.pulse += c.speed;
            const py = (c.pulse % 1) * H;
            const cg = atx!.createLinearGradient(0, py - 40, 0, py + 40);
            cg.addColorStop(0, "transparent");
            cg.addColorStop(0.5, "rgba(163,230,53,.04)");
            cg.addColorStop(1, "transparent");
            atx!.strokeStyle = cg;
            atx!.lineWidth = 1;
            atx!.beginPath();
            atx!.moveTo(c.x, 0);
            atx!.lineTo(c.x, H);
            atx!.stroke();
          }
          atmosRaf = requestAnimationFrame(drawAtmos);
        }
        atmosRaf = requestAnimationFrame(drawAtmos);
        cleanups.push(() => cancelAnimationFrame(atmosRaf));
      }
    }

    // ── Energy Reactor canvas ──
    const rCanvas = document.getElementById(
      "energy-reactor-canvas",
    ) as HTMLCanvasElement | null;
    const filC = document.getElementById(
      "filaments",
    ) as HTMLCanvasElement | null;

    let reactorRaf = 0;
    let filamentRaf = 0;
    let breathRaf = 0;
    let floatRaf = 0;
    let edgeEnergyRaf = 0;
    let reactorParallaxRaf = 0;
    // (pipeline RAF handles are scoped inside each canvas block below)
    let feedsRaf = 0;
    let latencyRaf = 0;
    let intelRaf = 0;
    let surfaceRaf = 0;

    const initReactor = () => {
      if (destroyed) return;

      if (rCanvas) {
        setTimeout(() => rCanvas.classList.add("loaded"), 100);
        const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
        const rRect = rCanvas.parentElement!.getBoundingClientRect();
        let rSize = Math.min(rRect.width, rRect.height, 800);
        rCanvas.width = rSize * dpr;
        rCanvas.height = rSize * dpr;
        rCanvas.style.width = rSize + "px";
        rCanvas.style.height = rSize + "px";
        const rxMaybe = rCanvas.getContext("2d", { alpha: true });
        if (!rxMaybe) return;
        const rx = rxMaybe;
        rx.scale(dpr, dpr);
        let cx = rSize / 2,
          cy = rSize / 2;

        let mx = 0,
          my = 0;
        const reactorMouseMove = (e: MouseEvent) => {
          mx = (e.clientX / innerWidth - 0.5) * 2;
          my = (e.clientY / innerHeight - 0.5) * 2;
        };
        document.addEventListener("mousemove", reactorMouseMove);
        cleanups.push(() =>
          document.removeEventListener("mousemove", reactorMouseMove),
        );

        const PARTICLE_COUNT = 400;
        const rParticles: Array<{
          size: number;
          maxDist: number;
          dist: number;
          angle: number;
          brightness: number;
          speed: number;
        }> = [];
        for (let i = 0; i < PARTICLE_COUNT; i++) {
          const angle = Math.random() * Math.PI * 2;
          const maxDist = 60 + Math.random() * 300;
          rParticles.push({
            size: 0.8 + Math.random() * 2.5,
            maxDist,
            dist: Math.random() * maxDist,
            angle,
            brightness: 0.5 + Math.random() * 0.5,
            speed: 0.4 + Math.random() * 2,
          });
        }

        const SPARK_COUNT = 30;
        const sparks: Array<{
          angle: number;
          dist: number;
          speed: number;
          size: number;
          drift: number;
          phase: number;
          bright: number;
        }> = [];
        for (let i = 0; i < SPARK_COUNT; i++) {
          sparks.push({
            angle: Math.random() * Math.PI * 2,
            dist: 20 + Math.random() * 250,
            speed: 0.01 + Math.random() * 0.025,
            size: 0.5 + Math.random() * 1.5,
            drift: (Math.random() - 0.5) * 0.4,
            phase: Math.random() * Math.PI * 2,
            bright: 0.5 + Math.random() * 0.5,
          });
        }

        const TENDRIL_COUNT = 8;
        const tendrils: Array<{
          baseAngle: number;
          length: number;
          width: number;
          speed: number;
          segments: number;
          phase: number;
          jitter: number;
          bright: number;
        }> = [];
        for (let i = 0; i < TENDRIL_COUNT; i++) {
          tendrils.push({
            baseAngle:
              ((Math.PI * 2) / TENDRIL_COUNT) * i + Math.random() * 0.3,
            length: 100 + Math.random() * 180,
            width: 1 + Math.random() * 1.5,
            speed: 0.005 + Math.random() * 0.015,
            segments: 10 + Math.floor(Math.random() * 6),
            phase: Math.random() * Math.PI * 2,
            jitter: 8 + Math.random() * 12,
            bright: 0.4 + Math.random() * 0.4,
          });
        }

        const BOLT_COUNT = 4;
        interface Bolt {
          angle: number;
          length: number;
          segments: number;
          life: number;
          maxLife: number;
          width: number;
          cooldown: number;
          points: Array<{ x: number; y: number }>;
        }
        const bolts: Bolt[] = [];
        function resetBolt(b: Bolt) {
          b.angle = Math.random() * Math.PI * 2;
          b.length = 80 + Math.random() * 160;
          b.segments = 6 + Math.floor(Math.random() * 5);
          b.life = 0;
          b.maxLife = 0.12 + Math.random() * 0.18;
          b.width = 0.8 + Math.random() * 1.5;
          b.cooldown = 1.5 + Math.random() * 4;
          b.points = [];
          let px = cx,
            py = cy;
          const step = b.length / b.segments;
          for (let j = 0; j <= b.segments; j++) {
            b.points.push({ x: px, y: py });
            px += Math.cos(b.angle) * step + (Math.random() - 0.5) * 28;
            py += Math.sin(b.angle) * step + (Math.random() - 0.5) * 28;
          }
        }
        for (let i = 0; i < BOLT_COUNT; i++) {
          const b: Bolt = {
            angle: 0,
            length: 0,
            segments: 0,
            life: 0,
            maxLife: 0,
            width: 0,
            cooldown: Math.random() * 3,
            points: [],
          };
          resetBolt(b);
          b.cooldown = Math.random() * 3;
          bolts.push(b);
        }

        const waves: Array<{ r: number; maxR: number; speed: number }> = [];
        let waveTimer = 0;
        let ringAngle = 0;

        let lastTime = 0;
        const FRAME_BUDGET = 33;

        function renderReactor(time: number) {
          if (destroyed) return;
          if (time - lastTime < FRAME_BUDGET) {
            reactorRaf = requestAnimationFrame(renderReactor);
            return;
          }
          const dt = Math.min((time - lastTime) / 1000, 0.05);
          lastTime = time;
          const t = time * 0.001;

          rx.clearRect(0, 0, rSize, rSize);
          const px = mx * 12;
          const py = my * 8;
          rx.save();
          rx.translate(px, py);

          // Volumetric core glow
          const coreIntensity =
            0.15 + Math.sin(t * 1.5) * 0.05 + Math.sin(t * 3.7) * 0.03;
          const grad1 = rx.createRadialGradient(cx, cy, 0, cx, cy, 280);
          grad1.addColorStop(
            0,
            "rgba(200,240,120," + coreIntensity * 2 + ")",
          );
          grad1.addColorStop(
            0.05,
            "rgba(163,230,53," + coreIntensity * 1.5 + ")",
          );
          grad1.addColorStop(
            0.2,
            "rgba(120,180,40," + coreIntensity * 0.7 + ")",
          );
          grad1.addColorStop(
            0.5,
            "rgba(80,140,25," + coreIntensity * 0.2 + ")",
          );
          grad1.addColorStop(1, "rgba(40,70,12,0)");
          rx.fillStyle = grad1;
          rx.fillRect(0, 0, rSize, rSize);

          const pulse2 = 0.08 + Math.sin(t * 2.3 + 1) * 0.04;
          const grad2 = rx.createRadialGradient(cx, cy, 0, cx, cy, 180);
          grad2.addColorStop(
            0,
            "rgba(255,255,255," + pulse2 * 1.5 + ")",
          );
          grad2.addColorStop(0.1, "rgba(190,240,110," + pulse2 + ")");
          grad2.addColorStop(
            0.4,
            "rgba(163,230,53," + pulse2 * 0.3 + ")",
          );
          grad2.addColorStop(1, "transparent");
          rx.fillStyle = grad2;
          rx.fillRect(0, 0, rSize, rSize);

          // Particles
          rx.globalCompositeOperation = "lighter";
          for (const p of rParticles) {
            p.dist += p.speed * 60 * dt;
            if (p.dist > p.maxDist) {
              p.dist = Math.random() * 15;
              p.angle = Math.random() * Math.PI * 2;
              p.brightness = 0.5 + Math.random() * 0.5;
              p.maxDist = 60 + Math.random() * 300;
              p.size = 0.8 + Math.random() * 2.5;
            }
            const life = p.dist / p.maxDist;
            const fade = life < 0.1 ? life * 10 : 1 - life;
            const alpha =
              fade *
              p.brightness *
              (0.5 + Math.sin(t * 2.5 + p.angle) * 0.12);
            if (alpha < 0.02) continue;
            const x =
              cx +
              Math.cos(
                p.angle + Math.sin(t * 0.4 + p.dist * 0.008) * 0.15,
              ) *
                p.dist;
            const y =
              cy +
              Math.sin(
                p.angle + Math.sin(t * 0.4 + p.dist * 0.008) * 0.15,
              ) *
                p.dist;
            const sz = p.size * (1 + fade * 0.4);
            rx.globalAlpha = alpha;
            rx.fillStyle = life < 0.3 ? "#d2f08c" : "#a3e635";
            rx.beginPath();
            rx.arc(x, y, sz, 0, Math.PI * 2);
            rx.fill();
          }
          rx.globalAlpha = 1;

          // Plasma tendrils
          for (const td of tendrils) {
            td.phase += td.speed;
            const a = td.baseAngle + Math.sin(t * 0.3 + td.phase) * 0.4;
            const bright =
              td.bright * (0.6 + Math.sin(t * 2 + td.phase) * 0.4);
            if (bright < 0.08) continue;
            rx.beginPath();
            rx.moveTo(cx, cy);
            for (let j = 1; j <= td.segments; j++) {
              const frac = j / td.segments;
              const dist = frac * td.length;
              const jx =
                Math.sin(t * 3.5 + j * 1.5 + td.phase) * td.jitter * frac;
              const jy =
                Math.cos(t * 3 + j * 1.7 + td.phase) * td.jitter * frac;
              rx.lineTo(
                cx + Math.cos(a) * dist + jx,
                cy + Math.sin(a) * dist + jy,
              );
            }
            rx.strokeStyle = "rgba(163,230,53," + bright * 0.4 + ")";
            rx.lineWidth = td.width;
            rx.stroke();
            rx.strokeStyle = "rgba(163,230,53," + bright * 0.12 + ")";
            rx.lineWidth = td.width * 4;
            rx.stroke();
          }

          // Lightning bolts
          for (const b of bolts) {
            if (b.cooldown > 0) {
              b.cooldown -= dt;
              continue;
            }
            b.life += dt;
            if (b.life > b.maxLife) {
              resetBolt(b);
              continue;
            }
            const alpha = 1 - b.life / b.maxLife;
            rx.beginPath();
            rx.moveTo(b.points[0].x, b.points[0].y);
            for (let j = 1; j < b.points.length; j++) {
              rx.lineTo(
                b.points[j].x + (Math.random() - 0.5) * 3,
                b.points[j].y + (Math.random() - 0.5) * 3,
              );
            }
            rx.strokeStyle = "rgba(163,230,53," + alpha * 0.2 + ")";
            rx.lineWidth = b.width * alpha * 5;
            rx.stroke();
            rx.strokeStyle = "rgba(200,240,130," + alpha * 0.7 + ")";
            rx.lineWidth = b.width * alpha;
            rx.stroke();
            rx.strokeStyle = "rgba(255,255,255," + alpha * 0.4 + ")";
            rx.lineWidth = b.width * alpha * 0.3;
            rx.stroke();
          }

          // Floating sparks
          for (const s of sparks) {
            s.angle += s.speed;
            s.dist += s.drift * dt * 8;
            if (s.dist > 300 || s.dist < 15) {
              s.dist = 20 + Math.random() * 180;
              s.drift = (Math.random() - 0.5) * 0.4;
            }
            const flicker =
              Math.sin(t * 6 + s.phase) > 0.3
                ? s.bright
                : s.bright * 0.15;
            const x = cx + Math.cos(s.angle) * s.dist;
            const y = cy + Math.sin(s.angle) * s.dist;
            rx.globalAlpha = flicker;
            rx.fillStyle = "#d2f08c";
            rx.beginPath();
            rx.arc(x, y, s.size, 0, Math.PI * 2);
            rx.fill();
            rx.globalAlpha = flicker * 0.25;
            rx.beginPath();
            rx.arc(x, y, s.size * 4, 0, Math.PI * 2);
            rx.fill();
          }
          rx.globalAlpha = 1;

          // Rotating energy ring
          ringAngle += dt * 0.3;
          rx.save();
          rx.translate(cx, cy);
          rx.rotate(ringAngle);
          const ringR = 110 + Math.sin(t * 1.2) * 8;
          const ringAlpha = 0.1 + Math.sin(t * 2) * 0.04;
          rx.beginPath();
          rx.arc(0, 0, ringR, 0, Math.PI * 2);
          rx.strokeStyle = "rgba(163,230,53," + ringAlpha + ")";
          rx.lineWidth = 2;
          rx.stroke();
          rx.strokeStyle = "rgba(163,230,53," + ringAlpha * 0.3 + ")";
          rx.lineWidth = 6;
          rx.stroke();
          rx.setLineDash([4, 14]);
          rx.beginPath();
          rx.arc(0, 0, ringR + 18, 0, Math.PI * 2);
          rx.strokeStyle = "rgba(163,230,53," + ringAlpha * 0.4 + ")";
          rx.lineWidth = 1;
          rx.stroke();
          rx.setLineDash([]);
          rx.restore();

          // Shockwave rings
          waveTimer += dt;
          if (waveTimer > 2.5 + Math.random() * 3) {
            waves.push({
              r: 10,
              maxR: 180 + Math.random() * 120,
              speed: 70 + Math.random() * 50,
            });
            waveTimer = 0;
          }
          for (let i = waves.length - 1; i >= 0; i--) {
            const w = waves[i];
            w.r += w.speed * dt;
            if (w.r > w.maxR) {
              waves.splice(i, 1);
              continue;
            }
            const a = (1 - w.r / w.maxR) * 0.12;
            rx.beginPath();
            rx.arc(cx, cy, w.r, 0, Math.PI * 2);
            rx.strokeStyle = "rgba(163,230,53," + a + ")";
            rx.lineWidth = 1.5 * (1 - w.r / w.maxR);
            rx.stroke();
          }

          // Bright core lens bloom
          const bloom =
            0.15 + Math.sin(t * 2.5) * 0.08 + Math.sin(t * 7) * 0.03;
          const coreG = rx.createRadialGradient(cx, cy, 0, cx, cy, 55);
          coreG.addColorStop(0, "rgba(255,255,255," + bloom * 1.5 + ")");
          coreG.addColorStop(0.2, "rgba(210,240,140," + bloom + ")");
          coreG.addColorStop(0.5, "rgba(163,230,53," + bloom * 0.4 + ")");
          coreG.addColorStop(1, "rgba(65,120,20,0)");
          rx.fillStyle = coreG;
          rx.beginPath();
          rx.arc(cx, cy, 55, 0, Math.PI * 2);
          rx.fill();

          // Horizontal lens flare
          const flareAlpha = 0.03 + Math.sin(t * 1.8) * 0.015;
          rx.globalAlpha = flareAlpha;
          rx.fillStyle = "#a3e635";
          rx.fillRect(cx - 250, cy - 1.5, 500, 3);
          rx.globalAlpha = 1;

          rx.globalCompositeOperation = "source-over";
          rx.restore();

          reactorRaf = requestAnimationFrame(renderReactor);
        }
        reactorRaf = requestAnimationFrame(renderReactor);
        cleanups.push(() => cancelAnimationFrame(reactorRaf));

        const reactorResizeHandler = () => {
          const r = rCanvas.parentElement!.getBoundingClientRect();
          const s = Math.min(r.width, r.height, 1100);
          rSize = s;
          cx = s / 2;
          cy = s / 2;
          rCanvas.width = s * dpr;
          rCanvas.height = s * dpr;
          rCanvas.style.width = s + "px";
          rCanvas.style.height = s + "px";
          rx.scale(dpr, dpr);
        };
        window.addEventListener("resize", reactorResizeHandler);
        cleanups.push(() =>
          window.removeEventListener("resize", reactorResizeHandler),
        );
      }

      // ── Filament wisps ──
      if (filC) {
        const fctx = filC.getContext("2d");
        if (fctx) {
          const fw = filC.width,
            fh = filC.height;
          const fcx = fw / 2,
            fcy = fh / 2;
          const wisps = Array.from({ length: 12 }, () => ({
            angle: Math.random() * Math.PI * 2,
            dist: 70 + Math.random() * 70,
            speed: 0.004 + Math.random() * 0.006,
            len: 0.3 + Math.random() * 0.6,
            w: 0.5 + Math.random() * 1,
          }));
          function drawFilaments(t: number) {
            if (destroyed) return;
            fctx!.clearRect(0, 0, fw, fh);
            fctx!.globalCompositeOperation = "lighter";
            for (const w of wisps) {
              w.angle += w.speed;
              const a1 = w.angle;
              const a2 = w.angle + w.len;
              fctx!.beginPath();
              fctx!.arc(fcx, fcy, w.dist, a1, a2);
              const alpha = 0.15 + Math.sin(t * 0.001 + w.angle) * 0.08;
              fctx!.strokeStyle = "rgba(163,230,53," + alpha + ")";
              fctx!.lineWidth = w.w;
              fctx!.shadowColor = "rgba(184,239,92,.4)";
              fctx!.shadowBlur = 8;
              fctx!.stroke();
              fctx!.shadowBlur = 0;
            }
            fctx!.globalCompositeOperation = "source-over";
            filamentRaf = requestAnimationFrame(drawFilaments);
          }
          filamentRaf = requestAnimationFrame(drawFilaments);
          cleanups.push(() => cancelAnimationFrame(filamentRaf));
        }
      }

      // ── Logo atmosphere ──
      const logoImg = document.getElementById(
        "logo-img",
      ) as HTMLImageElement | null;
      const logoAtmos = document.getElementById("logo-atmos");
      if (logoImg && logoAtmos) {
        logoAtmos.style.backgroundImage = "url(" + logoImg.src + ")";
      }

      // ── Logo breathing ──
      const breathC = document.getElementById(
        "logo-breath",
      ) as HTMLCanvasElement | null;
      if (breathC) {
        const bctx = breathC.getContext("2d");
        if (bctx) {
          const bW = 500,
            bCx = bW / 2,
            bCy = bW / 2;
          const cracks = Array.from({ length: 12 }, () => ({
            x: bCx + (Math.random() - 0.5) * 160,
            y: bCy + (Math.random() - 0.5) * 160,
            size: 1 + Math.random() * 3,
            phase: Math.random() * Math.PI * 2,
            speed: 0.5 + Math.random() * 2,
          }));
          const arcs = Array.from({ length: 3 }, () => ({
            angle: Math.random() * Math.PI * 2,
            length: 30 + Math.random() * 50,
            phase: Math.random() * Math.PI * 2,
            nextFire: Math.random() * 200,
            active: 0,
          }));
          function drawBreath(time: number) {
            if (destroyed) return;
            const t = time * 0.001;
            bctx!.clearRect(0, 0, bW, bW);
            bctx!.globalCompositeOperation = "lighter";

            const pulse = 0.02 + Math.sin(t * 0.8) * 0.015;
            bctx!.globalAlpha = pulse;
            const bloomGrad = bctx!.createRadialGradient(
              bCx,
              bCy,
              20,
              bCx,
              bCy,
              180,
            );
            bloomGrad.addColorStop(0, "rgba(163,230,53,.6)");
            bloomGrad.addColorStop(0.4, "rgba(163,230,53,.2)");
            bloomGrad.addColorStop(1, "transparent");
            bctx!.fillStyle = bloomGrad;
            bctx!.fillRect(0, 0, bW, bW);

            for (const c of cracks) {
              const flicker = Math.max(0, Math.sin(t * c.speed + c.phase));
              if (flicker < 0.6) continue;
              const intensity = (flicker - 0.6) * 2.5;
              bctx!.globalAlpha = intensity * 0.4;
              bctx!.fillStyle = "#a3e635";
              bctx!.beginPath();
              bctx!.arc(c.x, c.y, c.size, 0, Math.PI * 2);
              bctx!.fill();
              bctx!.globalAlpha = intensity * 0.12;
              bctx!.beginPath();
              bctx!.arc(c.x, c.y, c.size * 5, 0, Math.PI * 2);
              bctx!.fill();
            }

            for (const a of arcs) {
              a.nextFire--;
              if (a.nextFire <= 0 && a.active <= 0) {
                a.active = 8 + Math.random() * 12;
                a.angle = Math.random() * Math.PI * 2;
                a.length = 25 + Math.random() * 55;
                a.nextFire = 120 + Math.random() * 300;
              }
              if (a.active > 0) {
                a.active--;
                const fade = a.active / 20;
                const sx = bCx + Math.cos(a.angle) * 40;
                const sy = bCy + Math.sin(a.angle) * 40;
                bctx!.beginPath();
                bctx!.moveTo(sx, sy);
                const segs = 4;
                for (let j = 1; j <= segs; j++) {
                  const frac = j / segs;
                  const dist = frac * a.length;
                  const jx = (Math.random() - 0.5) * 16 * frac;
                  const jy = (Math.random() - 0.5) * 16 * frac;
                  bctx!.lineTo(
                    sx + Math.cos(a.angle) * dist + jx,
                    sy + Math.sin(a.angle) * dist + jy,
                  );
                }
                bctx!.strokeStyle =
                  "rgba(163,230,53," + 0.4 * fade + ")";
                bctx!.lineWidth = 1;
                bctx!.stroke();
                bctx!.strokeStyle =
                  "rgba(163,230,53," + 0.1 * fade + ")";
                bctx!.lineWidth = 4;
                bctx!.stroke();
              }
            }

            bctx!.globalCompositeOperation = "source-over";
            breathRaf = requestAnimationFrame(drawBreath);
          }
          breathRaf = requestAnimationFrame(drawBreath);
          cleanups.push(() => cancelAnimationFrame(breathRaf));

          const rCore = document.querySelector(".r-core") as HTMLElement | null;
          if (rCore) {
            function floatLogo(time: number) {
              if (destroyed) return;
              const t = time * 0.001;
              const dx = Math.sin(t * 0.4) * 1.5;
              const dy = Math.cos(t * 0.3) * 1.2;
              rCore!.style.transform =
                "translate(" + dx + "px," + dy + "px)";
              floatRaf = requestAnimationFrame(floatLogo);
            }
            floatRaf = requestAnimationFrame(floatLogo);
            cleanups.push(() => cancelAnimationFrame(floatRaf));
          }
        }
      }

      // ── Logo edge energy ──
      const edgeC = document.getElementById(
        "logo-edge-energy",
      ) as HTMLCanvasElement | null;
      if (edgeC) {
        const ectx = edgeC.getContext("2d");
        if (ectx) {
          const eSize = 700,
            eCx = eSize / 2,
            eCy = eSize / 2;
          const edgeParticles = Array.from({ length: 50 }, () => ({
            angle: Math.random() * Math.PI * 2,
            dist: 130 + Math.random() * 180,
            speed: 0.003 + Math.random() * 0.008,
            size: 0.4 + Math.random() * 1.5,
            drift: (Math.random() - 0.5) * 0.3,
            bright: 0.3 + Math.random() * 0.6,
          }));
          const edgeTendrils = Array.from({ length: 6 }, (_, i) => ({
            baseAngle: ((Math.PI * 2) / 6) * i + Math.random() * 0.5,
            length: 120 + Math.random() * 80,
            segments: 6 + Math.floor(Math.random() * 4),
            phase: Math.random() * Math.PI * 2,
            speed: 0.004 + Math.random() * 0.01,
            width: 0.6 + Math.random() * 1,
            bright: 0.2 + Math.random() * 0.35,
          }));
          function drawEdgeEnergy(time: number) {
            if (destroyed) return;
            const t = time * 0.001;
            ectx!.clearRect(0, 0, eSize, eSize);
            ectx!.globalCompositeOperation = "lighter";
            for (const p of edgeParticles) {
              p.angle += p.speed;
              p.dist += p.drift * 0.3;
              if (p.dist > 310 || p.dist < 120) {
                p.dist = 130 + Math.random() * 150;
                p.drift = (Math.random() - 0.5) * 0.3;
              }
              const flicker =
                (0.6 + Math.sin(t * 5 + p.angle * 3) * 0.4) * p.bright;
              const x = eCx + Math.cos(p.angle) * p.dist;
              const y = eCy + Math.sin(p.angle) * p.dist;
              ectx!.globalAlpha = flicker;
              ectx!.fillStyle = "#a3e635";
              ectx!.beginPath();
              ectx!.arc(x, y, p.size, 0, Math.PI * 2);
              ectx!.fill();
              ectx!.globalAlpha = flicker * 0.2;
              ectx!.beginPath();
              ectx!.arc(x, y, p.size * 4, 0, Math.PI * 2);
              ectx!.fill();
            }
            ectx!.globalAlpha = 1;
            for (const td of edgeTendrils) {
              td.phase += td.speed;
              const a =
                td.baseAngle + Math.sin(t * 0.4 + td.phase) * 0.3;
              const bright =
                td.bright * (0.5 + Math.sin(t * 1.8 + td.phase) * 0.5);
              if (bright < 0.05) continue;
              ectx!.beginPath();
              const startDist = 100;
              ectx!.moveTo(
                eCx + Math.cos(a) * startDist,
                eCy + Math.sin(a) * startDist,
              );
              for (let j = 1; j <= td.segments; j++) {
                const frac = j / td.segments;
                const dist = startDist + frac * td.length;
                const jx =
                  Math.sin(t * 3 + j * 2 + td.phase) * 10 * frac;
                const jy =
                  Math.cos(t * 2.5 + j * 2.2 + td.phase) * 10 * frac;
                ectx!.lineTo(
                  eCx + Math.cos(a) * dist + jx,
                  eCy + Math.sin(a) * dist + jy,
                );
              }
              ectx!.strokeStyle =
                "rgba(163,230,53," + bright * 0.5 + ")";
              ectx!.lineWidth = td.width;
              ectx!.stroke();
              ectx!.strokeStyle =
                "rgba(163,230,53," + bright * 0.15 + ")";
              ectx!.lineWidth = td.width * 4;
              ectx!.stroke();
            }
            ectx!.globalCompositeOperation = "source-over";
            edgeEnergyRaf = requestAnimationFrame(drawEdgeEnergy);
          }
          edgeEnergyRaf = requestAnimationFrame(drawEdgeEnergy);
          cleanups.push(() => cancelAnimationFrame(edgeEnergyRaf));
        }
      }

      // ── Reactor parallax ──
      const heroReactor = document.getElementById("hero-reactor");
      if (heroReactor) {
        let rmx = 0,
          rmy = 0;
        const parallaxMouseMove = (e: MouseEvent) => {
          rmx = (e.clientX / innerWidth - 0.5) * 2;
          rmy = (e.clientY / innerHeight - 0.5) * 2;
        };
        document.addEventListener("mousemove", parallaxMouseMove);
        cleanups.push(() =>
          document.removeEventListener("mousemove", parallaxMouseMove),
        );
        function reactorParallax() {
          if (destroyed) return;
          heroReactor!.style.transform =
            "translate(" + rmx * 5 + "px," + rmy * 4 + "px)";
          reactorParallaxRaf = requestAnimationFrame(reactorParallax);
        }
        reactorParallaxRaf = requestAnimationFrame(reactorParallax);
        cleanups.push(() => cancelAnimationFrame(reactorParallaxRaf));
      }
    };

    if ("requestIdleCallback" in window) {
      const idleId = (
        window as Window & {
          requestIdleCallback: (
            cb: () => void,
            opts?: { timeout: number },
          ) => number;
        }
      ).requestIdleCallback(initReactor, { timeout: 300 });
      cleanups.push(() =>
        (
          window as Window & { cancelIdleCallback: (id: number) => void }
        ).cancelIdleCallback(idleId),
      );
    } else {
      const tid = setTimeout(initReactor, 200);
      cleanups.push(() => clearTimeout(tid));
    }

    // ── Intelligence Pipeline — scroll-triggered stage reveals + canvas animations ──

    const pipeStages = document.querySelectorAll("[data-pipe-stage]");
    const pipeConduits = document.querySelectorAll("[data-pipe-conduit]");
    if (pipeStages.length) {
      const stageOrder = ["ingress", "identify", "validate", "execute", "results", "summary"];
      const litStages = new Set<string>();

      const pipeObs = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            const el = entry.target as HTMLElement;
            const stage = el.dataset.pipeStage;
            if (!stage) continue;
            if (entry.isIntersecting && !litStages.has(stage)) {
              litStages.add(stage);
              el.classList.add("pipe-lit");
              const idx = stageOrder.indexOf(stage);
              if (idx > 0) {
                const conduit = document.querySelector(`[data-pipe-conduit="${idx - 1}"]`);
                if (conduit) conduit.classList.add("pipe-lit");
              }
              // Update status text
              const statusEl = el.querySelector(".pipe-status");
              if (statusEl) statusEl.classList.add("is-live");
            }
          }
        },
        { threshold: 0.2, rootMargin: "0px 0px -60px 0px" },
      );
      pipeStages.forEach((el) => pipeObs.observe(el));
      pipeConduits.forEach((el) => pipeObs.observe(el));
      cleanups.push(() => pipeObs.disconnect());
    }

    // ── INGEST ticker bar canvas ──
    const cvIngest = document.getElementById("cv-ingest") as HTMLCanvasElement | null;
    if (cvIngest) {
      const ictx = cvIngest.getContext("2d");
      if (ictx) {
        const IW = 400, IH = 60;
        const dots = Array.from({ length: 20 }, (_, i) => ({
          x: (i / 20) * IW, speed: 1 + i * 0.15, size: 1 + (i % 3) * 0.5,
        }));
        let ingestRaf = 0;
        function drawIngest(t: number) {
          if (destroyed) return;
          const s = t * 0.001;
          ictx!.clearRect(0, 0, IW, IH);
          ictx!.globalCompositeOperation = "lighter";
          for (const d of dots) {
            d.x = (d.x + d.speed) % IW;
            const alpha = 0.15 + Math.sin(s * 2 + d.x * 0.02) * 0.1;
            ictx!.fillStyle = "rgba(163,230,53," + alpha + ")";
            ictx!.beginPath();
            ictx!.arc(d.x, IH / 2, d.size, 0, Math.PI * 2);
            ictx!.fill();
            const glow = ictx!.createRadialGradient(d.x, IH / 2, 0, d.x, IH / 2, d.size * 4);
            glow.addColorStop(0, "rgba(163,230,53," + alpha * 0.3 + ")");
            glow.addColorStop(1, "transparent");
            ictx!.fillStyle = glow;
            ictx!.fillRect(d.x - d.size * 4, IH / 2 - d.size * 4, d.size * 8, d.size * 8);
          }
          ictx!.globalCompositeOperation = "source-over";
          ingestRaf = requestAnimationFrame(drawIngest);
        }
        ingestRaf = requestAnimationFrame(drawIngest);
        cleanups.push(() => cancelAnimationFrame(ingestRaf));
      }
    }

    // ── IDENTIFY canvas — radar sweep + GEX heatmap + flowing particles ──
    const cvPipeId = document.getElementById("cv-pipe-identify") as HTMLCanvasElement | null;
    if (cvPipeId) {
      const ctx = cvPipeId.getContext("2d");
      if (ctx) {
        const W = 560, H = 320;
        const particles = Array.from({ length: 50 }, () => ({
          x: Math.random() * W, y: Math.random() * H,
          size: 0.8 + Math.random() * 2, vx: (Math.random() - 0.5) * 0.8,
          vy: (Math.random() - 0.5) * 0.5, bright: Math.random(),
        }));
        const walls = [
          { x: 0.22, h: 0.7, label: "5580" }, { x: 0.40, h: 0.9, label: "5620" },
          { x: 0.58, h: 0.5, label: "5650" }, { x: 0.76, h: 0.8, label: "5680" },
        ];
        let idRaf = 0;
        function drawPipeIdentify(t: number) {
          if (destroyed) return;
          const s = t * 0.001;
          ctx!.clearRect(0, 0, W, H);

          // Subtle grid
          ctx!.strokeStyle = "rgba(163,230,53,.03)";
          ctx!.lineWidth = 0.5;
          for (let x = 0; x < W; x += 40) { ctx!.beginPath(); ctx!.moveTo(x, 0); ctx!.lineTo(x, H); ctx!.stroke(); }
          for (let y = 0; y < H; y += 40) { ctx!.beginPath(); ctx!.moveTo(0, y); ctx!.lineTo(W, y); ctx!.stroke(); }

          // Radar sweep
          const cx = W * 0.18, cy = H * 0.45, R = 90;
          const angle = (s * 0.7) % (Math.PI * 2);
          ctx!.save();
          ctx!.globalAlpha = 0.2;
          ctx!.beginPath(); ctx!.moveTo(cx, cy);
          ctx!.arc(cx, cy, R, angle - 0.5, angle, false);
          ctx!.closePath();
          const sweep = ctx!.createRadialGradient(cx, cy, 0, cx, cy, R);
          sweep.addColorStop(0, "rgba(163,230,53,.5)");
          sweep.addColorStop(1, "transparent");
          ctx!.fillStyle = sweep; ctx!.fill();
          ctx!.restore();
          for (let r = 30; r <= R; r += 30) {
            ctx!.strokeStyle = "rgba(163,230,53,.06)"; ctx!.lineWidth = 0.5;
            ctx!.beginPath(); ctx!.arc(cx, cy, r, 0, Math.PI * 2); ctx!.stroke();
          }
          // Crosshairs
          ctx!.strokeStyle = "rgba(163,230,53,.05)"; ctx!.lineWidth = 0.5;
          ctx!.beginPath(); ctx!.moveTo(cx - R, cy); ctx!.lineTo(cx + R, cy); ctx!.stroke();
          ctx!.beginPath(); ctx!.moveTo(cx, cy - R); ctx!.lineTo(cx, cy + R); ctx!.stroke();

          // GEX heatmap bars
          const barArea = { x: W * 0.38, w: W * 0.58, y: 30, h: H - 60 };
          for (const w of walls) {
            const bx = barArea.x + w.x * barArea.w;
            const pulse = 0.6 + Math.sin(s * 1.5 + w.x * 10) * 0.3;
            const bh = barArea.h * w.h * pulse;
            const grad = ctx!.createLinearGradient(bx, barArea.y + barArea.h, bx, barArea.y + barArea.h - bh);
            grad.addColorStop(0, "rgba(163,230,53,.02)");
            grad.addColorStop(0.5, "rgba(163,230,53," + (0.08 * pulse) + ")");
            grad.addColorStop(1, "rgba(163,230,53," + (0.2 * pulse) + ")");
            ctx!.fillStyle = grad;
            ctx!.fillRect(bx - 12, barArea.y + barArea.h - bh, 24, bh);
            // Bar top glow
            ctx!.fillStyle = "rgba(163,230,53," + (0.4 * pulse) + ")";
            ctx!.fillRect(bx - 12, barArea.y + barArea.h - bh, 24, 2);
            // Label
            ctx!.font = "7px monospace";
            ctx!.fillStyle = "rgba(163,230,53,.3)";
            ctx!.fillText(w.label, bx - 10, barArea.y + barArea.h + 14);
          }

          // Flowing particles
          ctx!.globalCompositeOperation = "lighter";
          for (const p of particles) {
            p.x += p.vx; p.y += p.vy;
            if (p.x < 0 || p.x > W) p.vx *= -1;
            if (p.y < 0 || p.y > H) p.vy *= -1;
            const dist = Math.sqrt((p.x - cx) ** 2 + (p.y - cy) ** 2);
            const inSweep = Math.abs(Math.atan2(p.y - cy, p.x - cx) - angle) < 0.5 && dist < R;
            const alpha = inSweep ? 0.7 : 0.1 * p.bright;
            ctx!.globalAlpha = alpha;
            ctx!.fillStyle = "#a3e635";
            ctx!.beginPath(); ctx!.arc(p.x, p.y, p.size * (inSweep ? 2.5 : 1), 0, Math.PI * 2); ctx!.fill();
            if (inSweep) {
              ctx!.globalAlpha = 0.1;
              ctx!.beginPath(); ctx!.arc(p.x, p.y, p.size * 8, 0, Math.PI * 2); ctx!.fill();
            }
          }
          ctx!.globalCompositeOperation = "source-over"; ctx!.globalAlpha = 1;

          // Status readout
          const tickers = ["SPX", "SPY", "QQQ", "NVDA", "TSLA", "META"];
          const active = tickers[Math.floor(s * 0.5) % tickers.length];
          ctx!.font = "bold 9px monospace";
          ctx!.fillStyle = "rgba(163,230,53,.5)";
          ctx!.fillText("SCANNING: " + active, 12, H - 10);
          ctx!.fillStyle = "rgba(163,230,53,.25)";
          ctx!.fillText("GEX WALL EXPOSURE", barArea.x, 20);

          idRaf = requestAnimationFrame(drawPipeIdentify);
        }
        idRaf = requestAnimationFrame(drawPipeIdentify);
        cleanups.push(() => cancelAnimationFrame(idRaf));
      }
    }

    // ── VALIDATE canvas — verification pipeline + scoring meter + grade ──
    const cvPipeVal = document.getElementById("cv-pipe-validate") as HTMLCanvasElement | null;
    if (cvPipeVal) {
      const ctx = cvPipeVal.getContext("2d");
      if (ctx) {
        const W = 560, H = 320;
        const gates = ["FLOW", "GAMMA", "CORTEX", "CONFLUENCE", "BIE"];
        const gateX = gates.map((_, i) => 50 + (i * (W - 100)) / (gates.length - 1));
        let valRaf = 0;
        function drawPipeValidate(t: number) {
          if (destroyed) return;
          const s = t * 0.001;
          ctx!.clearRect(0, 0, W, H);

          // Background grid
          ctx!.strokeStyle = "rgba(34,211,238,.025)";
          ctx!.lineWidth = 0.5;
          for (let x = 0; x < W; x += 40) { ctx!.beginPath(); ctx!.moveTo(x, 0); ctx!.lineTo(x, H); ctx!.stroke(); }
          for (let y = 0; y < H; y += 40) { ctx!.beginPath(); ctx!.moveTo(0, y); ctx!.lineTo(W, y); ctx!.stroke(); }

          // Main pipeline track
          const trackY = 100;
          ctx!.strokeStyle = "rgba(34,211,238,.06)"; ctx!.lineWidth = 2;
          ctx!.beginPath(); ctx!.moveTo(gateX[0], trackY); ctx!.lineTo(gateX[gateX.length - 1], trackY); ctx!.stroke();

          // Gate nodes
          const passProgress = (s * 0.25) % (gates.length + 1);
          for (let i = 0; i < gates.length; i++) {
            const x = gateX[i];
            const passed = i < Math.floor(passProgress);
            const active = Math.abs(passProgress - i) < 0.5;
            const pulse = active ? 0.8 : (passed ? 0.5 : 0.15);

            // Gate glow
            ctx!.globalCompositeOperation = "lighter";
            const glow = ctx!.createRadialGradient(x, trackY, 0, x, trackY, 30);
            glow.addColorStop(0, "rgba(34,211,238," + pulse * 0.4 + ")");
            glow.addColorStop(1, "transparent");
            ctx!.fillStyle = glow;
            ctx!.fillRect(x - 30, trackY - 30, 60, 60);
            ctx!.globalCompositeOperation = "source-over";

            // Gate ring
            ctx!.strokeStyle = "rgba(34,211,238," + pulse * 0.6 + ")";
            ctx!.lineWidth = active ? 2 : 1;
            ctx!.beginPath(); ctx!.arc(x, trackY, active ? 14 : 10, 0, Math.PI * 2); ctx!.stroke();

            // Inner dot
            ctx!.fillStyle = "rgba(34,211,238," + pulse + ")";
            ctx!.beginPath(); ctx!.arc(x, trackY, active ? 5 : 3, 0, Math.PI * 2); ctx!.fill();

            // Check mark when passed
            if (passed) {
              ctx!.font = "bold 12px sans-serif";
              ctx!.fillStyle = "rgba(34,211,238,.8)";
              ctx!.fillText("✓", x - 4, trackY + 4);
            }

            // Gate label
            ctx!.font = "bold 8px monospace";
            ctx!.fillStyle = "rgba(34,211,238," + (passed ? 0.6 : 0.25) + ")";
            ctx!.textAlign = "center";
            ctx!.fillText(gates[i], x, trackY + 28);
            ctx!.textAlign = "left";

            // Connection line progress
            if (i < gates.length - 1) {
              const nx = gateX[i + 1];
              const p = Math.max(0, Math.min(1, passProgress - i));
              if (p > 0) {
                ctx!.strokeStyle = "rgba(34,211,238," + p * 0.4 + ")";
                ctx!.lineWidth = 2;
                ctx!.beginPath(); ctx!.moveTo(x + 16, trackY);
                ctx!.lineTo(x + 16 + (nx - x - 32) * p, trackY);
                ctx!.stroke();
              }
            }
          }

          // Data packet
          const packetX = gateX[0] + (passProgress / gates.length) * (gateX[gateX.length - 1] - gateX[0]);
          ctx!.globalCompositeOperation = "lighter";
          const pg = ctx!.createRadialGradient(packetX, trackY, 0, packetX, trackY, 12);
          pg.addColorStop(0, "rgba(34,211,238,.7)");
          pg.addColorStop(1, "transparent");
          ctx!.fillStyle = pg;
          ctx!.fillRect(packetX - 12, trackY - 12, 24, 24);
          ctx!.globalCompositeOperation = "source-over";

          // Scoring meter (bottom left)
          const conf = 2.5 + Math.sin(s * 0.4) * 2;
          const meterX = 30, meterY = 180, meterW = 180, meterH = 10;
          ctx!.fillStyle = "rgba(34,211,238,.06)";
          ctx!.beginPath(); ctx!.roundRect(meterX, meterY, meterW, meterH, 5); ctx!.fill();
          const fillW = meterW * (conf / 5);
          const meterGrad = ctx!.createLinearGradient(meterX, 0, meterX + fillW, 0);
          meterGrad.addColorStop(0, "rgba(34,211,238,.2)");
          meterGrad.addColorStop(1, "rgba(34,211,238,.5)");
          ctx!.fillStyle = meterGrad;
          ctx!.beginPath(); ctx!.roundRect(meterX, meterY, fillW, meterH, 5); ctx!.fill();
          // Meter glow tip
          ctx!.globalCompositeOperation = "lighter";
          const tipGlow = ctx!.createRadialGradient(meterX + fillW, meterY + meterH / 2, 0, meterX + fillW, meterY + meterH / 2, 15);
          tipGlow.addColorStop(0, "rgba(34,211,238,.3)");
          tipGlow.addColorStop(1, "transparent");
          ctx!.fillStyle = tipGlow;
          ctx!.fillRect(meterX + fillW - 15, meterY - 10, 30, 30);
          ctx!.globalCompositeOperation = "source-over";
          ctx!.font = "bold 8px monospace";
          ctx!.fillStyle = "rgba(34,211,238,.5)";
          ctx!.fillText("CONFLUENCE " + conf.toFixed(1) + "/5", meterX, meterY - 6);

          // Grade display (bottom right)
          const grades = ["A+", "A", "A-", "B+", "B", "A"];
          const grade = grades[Math.floor(s * 0.35) % grades.length];
          // Grade card
          ctx!.fillStyle = "rgba(0,0,0,.3)";
          ctx!.beginPath(); ctx!.roundRect(W - 130, 160, 110, 90, 10); ctx!.fill();
          ctx!.strokeStyle = "rgba(34,211,238,.1)";
          ctx!.lineWidth = 1;
          ctx!.beginPath(); ctx!.roundRect(W - 130, 160, 110, 90, 10); ctx!.stroke();
          ctx!.font = "bold 40px monospace";
          ctx!.fillStyle = "rgba(34,211,238,.6)";
          ctx!.textAlign = "center";
          ctx!.fillText(grade, W - 75, 215);
          ctx!.font = "8px monospace";
          ctx!.fillStyle = "rgba(34,211,238,.35)";
          ctx!.fillText("SETUP GRADE", W - 75, 240);
          ctx!.textAlign = "left";

          // Confidence lights
          const lightY = H - 30;
          const lights = 5;
          const lightOn = Math.ceil(conf);
          for (let i = 0; i < lights; i++) {
            const lx = 30 + i * 22;
            ctx!.fillStyle = i < lightOn ? "rgba(34,211,238," + (0.3 + (i / lights) * 0.4) + ")" : "rgba(34,211,238,.06)";
            ctx!.beginPath(); ctx!.roundRect(lx, lightY, 16, 6, 3); ctx!.fill();
            if (i < lightOn) {
              ctx!.globalCompositeOperation = "lighter";
              const lg = ctx!.createRadialGradient(lx + 8, lightY + 3, 0, lx + 8, lightY + 3, 12);
              lg.addColorStop(0, "rgba(34,211,238,.15)");
              lg.addColorStop(1, "transparent");
              ctx!.fillStyle = lg;
              ctx!.fillRect(lx - 4, lightY - 9, 24, 24);
              ctx!.globalCompositeOperation = "source-over";
            }
          }

          valRaf = requestAnimationFrame(drawPipeValidate);
        }
        valRaf = requestAnimationFrame(drawPipeValidate);
        cleanups.push(() => cancelAnimationFrame(valRaf));
      }
    }

    // ── EXECUTE canvas — candlestick chart + trade card + entry/stop/target ──
    const cvPipeEx = document.getElementById("cv-pipe-execute") as HTMLCanvasElement | null;
    if (cvPipeEx) {
      const ctx = cvPipeEx.getContext("2d");
      if (ctx) {
        const W = 560, H = 360;
        let exRaf = 0;
        function drawPipeExecute(t: number) {
          if (destroyed) return;
          const s = t * 0.001;
          ctx!.clearRect(0, 0, W, H);

          // Grid
          ctx!.strokeStyle = "rgba(191,95,255,.03)";
          ctx!.lineWidth = 0.5;
          for (let y = 30; y < H; y += 30) { ctx!.beginPath(); ctx!.moveTo(0, y); ctx!.lineTo(W, y); ctx!.stroke(); }
          for (let x = 0; x < W; x += 40) { ctx!.beginPath(); ctx!.moveTo(x, 0); ctx!.lineTo(x, H); ctx!.stroke(); }

          // Candlestick chart
          const chartX = 170, chartW = W - 190;
          const numCandles = 35;
          for (let i = 0; i < numCandles; i++) {
            const bx = chartX + (i / numCandles) * chartW;
            const cw = (chartW / numCandles) * 0.6;
            const base = 180 + Math.sin(i * 0.25 + 1) * 40 + Math.sin(i * 0.12) * 25;
            const open = base - 4 + Math.sin(s * 0.5 + i) * 3;
            const close = base + 4 + Math.sin(s * 0.7 + i * 1.3) * 7;
            const high = Math.min(open, close) - 3 - (i % 5) * 2;
            const low = Math.max(open, close) + 3 + (i % 4) * 1.5;
            const bull = close < open;

            ctx!.strokeStyle = bull ? "rgba(163,230,53,.35)" : "rgba(239,68,68,.3)";
            ctx!.fillStyle = bull ? "rgba(163,230,53,.2)" : "rgba(239,68,68,.15)";
            ctx!.lineWidth = 1;
            ctx!.beginPath(); ctx!.moveTo(bx + cw / 2, high); ctx!.lineTo(bx + cw / 2, low); ctx!.stroke();
            ctx!.fillRect(bx, Math.min(open, close), cw, Math.abs(close - open) + 1);
          }

          // Entry/Stop/Target lines
          const entryY = 160 + Math.sin(s * 0.15) * 4;
          const stopY = entryY + 55;
          const targetY = entryY - 50;

          // Target
          ctx!.strokeStyle = "rgba(163,230,53,.35)"; ctx!.lineWidth = 1; ctx!.setLineDash([6, 4]);
          ctx!.beginPath(); ctx!.moveTo(chartX, targetY); ctx!.lineTo(W - 10, targetY); ctx!.stroke();
          ctx!.setLineDash([]);
          ctx!.font = "bold 8px monospace"; ctx!.fillStyle = "rgba(163,230,53,.6)";
          ctx!.fillText("TARGET +100%", W - 95, targetY - 5);

          // Entry
          ctx!.strokeStyle = "rgba(191,95,255,.5)"; ctx!.lineWidth = 1.5; ctx!.setLineDash([6, 4]);
          ctx!.beginPath(); ctx!.moveTo(chartX, entryY); ctx!.lineTo(W - 10, entryY); ctx!.stroke();
          ctx!.setLineDash([]);
          ctx!.fillStyle = "rgba(191,95,255,.7)";
          ctx!.fillText("ENTRY $4.20", W - 85, entryY - 5);

          // Stop
          ctx!.strokeStyle = "rgba(239,68,68,.35)"; ctx!.lineWidth = 1; ctx!.setLineDash([4, 4]);
          ctx!.beginPath(); ctx!.moveTo(chartX, stopY); ctx!.lineTo(W - 10, stopY); ctx!.stroke();
          ctx!.setLineDash([]);
          ctx!.fillStyle = "rgba(239,68,68,.5)";
          ctx!.fillText("STOP -50%", W - 80, stopY - 5);

          // Entry arrow
          const arrowPulse = 0.5 + Math.sin(s * 3) * 0.3;
          ctx!.fillStyle = "rgba(191,95,255," + arrowPulse + ")";
          const ax = chartX + chartW * 0.65 + Math.sin(s) * 4;
          ctx!.beginPath(); ctx!.moveTo(ax, entryY - 14); ctx!.lineTo(ax + 10, entryY); ctx!.lineTo(ax, entryY + 14); ctx!.closePath(); ctx!.fill();

          // Trade card (left panel)
          ctx!.fillStyle = "rgba(0,0,0,.45)";
          ctx!.beginPath(); ctx!.roundRect(12, 14, 145, 120, 10); ctx!.fill();
          ctx!.strokeStyle = "rgba(191,95,255,.12)"; ctx!.lineWidth = 1;
          ctx!.beginPath(); ctx!.roundRect(12, 14, 145, 120, 10); ctx!.stroke();
          // Animated border glow
          ctx!.globalCompositeOperation = "lighter";
          const cardGlow = ctx!.createLinearGradient(12, 14, 157, 134);
          const glowPhase = (s * 0.5) % 1;
          cardGlow.addColorStop(Math.max(0, glowPhase - 0.2), "transparent");
          cardGlow.addColorStop(glowPhase, "rgba(191,95,255,.2)");
          cardGlow.addColorStop(Math.min(1, glowPhase + 0.2), "transparent");
          ctx!.strokeStyle = cardGlow; ctx!.lineWidth = 1.5;
          ctx!.beginPath(); ctx!.roundRect(12, 14, 145, 120, 10); ctx!.stroke();
          ctx!.globalCompositeOperation = "source-over";

          // Card content
          ctx!.font = "bold 11px monospace"; ctx!.fillStyle = "rgba(191,95,255,.85)";
          ctx!.fillText("SPX 0DTE CALL", 22, 36);
          ctx!.font = "9px monospace"; ctx!.fillStyle = "rgba(255,255,255,.45)";
          ctx!.fillText("5640C  |  Tier: A", 22, 52);
          const rr = (2.1 + Math.sin(s * 0.3) * 0.4).toFixed(1);
          ctx!.fillStyle = "rgba(163,230,53,.55)";
          ctx!.fillText("R:R  " + rr + ":1", 22, 68);
          ctx!.font = "8px monospace"; ctx!.fillStyle = "rgba(191,95,255,.4)";
          ctx!.fillText("NIGHT HAWK", 22, 86);
          ctx!.fillStyle = "rgba(255,255,255,.25)";
          ctx!.fillText("ENTRY  $4.20", 22, 102);
          ctx!.fillText("STOP   $2.10", 22, 116);
          ctx!.fillStyle = "rgba(163,230,53,.4)";
          ctx!.fillText("TARGET $8.40", 22, 130);

          // Bottom status bar
          ctx!.fillStyle = "rgba(0,0,0,.3)";
          ctx!.fillRect(0, H - 28, W, 28);
          ctx!.font = "bold 8px monospace";
          const statuses = ["READY", "LIVE", "ARMED"];
          const st = statuses[Math.floor(s * 0.3) % statuses.length];
          ctx!.fillStyle = "rgba(191,95,255,.5)";
          ctx!.fillText("STATUS: " + st, 16, H - 10);
          ctx!.fillStyle = "rgba(255,255,255,.2)";
          ctx!.fillText("SPX SLAYER  |  0DTE DESK", W - 190, H - 10);

          exRaf = requestAnimationFrame(drawPipeExecute);
        }
        exRaf = requestAnimationFrame(drawPipeExecute);
        cleanups.push(() => cancelAnimationFrame(exRaf));
      }
    }

    // ── RESULTS canvas — profit cards + grade badges + win history ──
    const cvPipeRes = document.getElementById("cv-pipe-results") as HTMLCanvasElement | null;
    if (cvPipeRes) {
      const ctx = cvPipeRes.getContext("2d");
      if (ctx) {
        const W = 560, H = 280;
        const plays = [
          { ticker: "SPX 5640C", grade: "A", pnl: "+82%", win: true },
          { ticker: "NVDA 140C", grade: "A-", pnl: "+45%", win: true },
          { ticker: "TSLA 270P", grade: "B+", pnl: "-50%", win: false },
          { ticker: "META 620C", grade: "A+", pnl: "+120%", win: true },
          { ticker: "SPX 5660C", grade: "B", pnl: "+30%", win: true },
        ];
        let resRaf = 0;
        function drawPipeResults(t: number) {
          if (destroyed) return;
          const s = t * 0.001;
          ctx!.clearRect(0, 0, W, H);

          // Subtle grid
          ctx!.strokeStyle = "rgba(163,230,53,.02)";
          ctx!.lineWidth = 0.5;
          for (let x = 0; x < W; x += 40) { ctx!.beginPath(); ctx!.moveTo(x, 0); ctx!.lineTo(x, H); ctx!.stroke(); }

          // Play result cards
          const cardW = 95, cardH = 55, gap = 12;
          const startX = 20;
          for (let i = 0; i < plays.length; i++) {
            const p = plays[i];
            const row = Math.floor(i / 3);
            const col = i % 3;
            const cx = startX + col * (cardW + gap);
            const cy = 20 + row * (cardH + gap + 20);
            const reveal = Math.max(0, Math.min(1, (s * 0.3) % 4 - i * 0.5));

            if (reveal <= 0) continue;

            ctx!.globalAlpha = reveal;
            // Card bg
            ctx!.fillStyle = "rgba(0,0,0,.35)";
            ctx!.beginPath(); ctx!.roundRect(cx, cy, cardW, cardH, 6); ctx!.fill();
            ctx!.strokeStyle = p.win ? "rgba(163,230,53,.12)" : "rgba(239,68,68,.1)";
            ctx!.lineWidth = 1;
            ctx!.beginPath(); ctx!.roundRect(cx, cy, cardW, cardH, 6); ctx!.stroke();
            // Ticker
            ctx!.font = "bold 8px monospace";
            ctx!.fillStyle = "rgba(255,255,255,.6)";
            ctx!.fillText(p.ticker, cx + 6, cy + 14);
            // PnL
            ctx!.font = "bold 14px monospace";
            ctx!.fillStyle = p.win ? "rgba(163,230,53,.7)" : "rgba(239,68,68,.6)";
            ctx!.fillText(p.pnl, cx + 6, cy + 34);
            // Grade badge
            ctx!.fillStyle = "rgba(34,211,238,.15)";
            ctx!.beginPath(); ctx!.roundRect(cx + cardW - 28, cy + 4, 22, 16, 3); ctx!.fill();
            ctx!.font = "bold 9px monospace";
            ctx!.fillStyle = "rgba(34,211,238,.7)";
            ctx!.fillText(p.grade, cx + cardW - 24, cy + 16);
            // Timestamp
            ctx!.font = "6px monospace";
            ctx!.fillStyle = "rgba(255,255,255,.2)";
            ctx!.fillText("10:" + String(30 + i * 7).padStart(2, "0") + " ET", cx + 6, cy + 48);

            ctx!.globalAlpha = 1;
          }

          // Win rate meter (right side)
          const mX = W - 190, mY = 30;
          ctx!.fillStyle = "rgba(0,0,0,.3)";
          ctx!.beginPath(); ctx!.roundRect(mX, mY, 170, 100, 10); ctx!.fill();
          ctx!.strokeStyle = "rgba(163,230,53,.08)"; ctx!.lineWidth = 1;
          ctx!.beginPath(); ctx!.roundRect(mX, mY, 170, 100, 10); ctx!.stroke();

          // Win rate arc
          const arcCx = mX + 55, arcCy = mY + 55, arcR = 32;
          const winRate = 0.72 + Math.sin(s * 0.2) * 0.05;
          ctx!.strokeStyle = "rgba(255,255,255,.04)"; ctx!.lineWidth = 6;
          ctx!.beginPath(); ctx!.arc(arcCx, arcCy, arcR, -Math.PI * 0.75, Math.PI * 0.75); ctx!.stroke();
          ctx!.strokeStyle = "rgba(163,230,53,.45)"; ctx!.lineWidth = 6;
          const arcAngle = -Math.PI * 0.75 + (Math.PI * 1.5) * winRate;
          ctx!.beginPath(); ctx!.arc(arcCx, arcCy, arcR, -Math.PI * 0.75, arcAngle); ctx!.stroke();
          // Glow at tip
          ctx!.globalCompositeOperation = "lighter";
          const tipX = arcCx + Math.cos(arcAngle) * arcR;
          const tipY = arcCy + Math.sin(arcAngle) * arcR;
          const tipG = ctx!.createRadialGradient(tipX, tipY, 0, tipX, tipY, 10);
          tipG.addColorStop(0, "rgba(163,230,53,.4)"); tipG.addColorStop(1, "transparent");
          ctx!.fillStyle = tipG; ctx!.fillRect(tipX - 10, tipY - 10, 20, 20);
          ctx!.globalCompositeOperation = "source-over";
          // Percentage
          ctx!.font = "bold 18px monospace";
          ctx!.fillStyle = "rgba(163,230,53,.7)";
          ctx!.textAlign = "center";
          ctx!.fillText(Math.round(winRate * 100) + "%", arcCx, arcCy + 6);
          ctx!.font = "6px monospace"; ctx!.fillStyle = "rgba(163,230,53,.35)";
          ctx!.fillText("WIN RATE", arcCx, arcCy + 18);
          ctx!.textAlign = "left";

          // Stats
          ctx!.font = "bold 9px monospace"; ctx!.fillStyle = "rgba(255,255,255,.5)";
          ctx!.fillText("142", mX + 120, mY + 40);
          ctx!.font = "6px monospace"; ctx!.fillStyle = "rgba(255,255,255,.25)";
          ctx!.fillText("PLAYS", mX + 120, mY + 50);
          ctx!.font = "bold 9px monospace"; ctx!.fillStyle = "rgba(163,230,53,.6)";
          ctx!.fillText("102", mX + 120, mY + 70);
          ctx!.font = "6px monospace"; ctx!.fillStyle = "rgba(163,230,53,.3)";
          ctx!.fillText("WINS", mX + 120, mY + 80);

          // Bottom: "PUBLIC LEDGER" label
          ctx!.fillStyle = "rgba(0,0,0,.25)";
          ctx!.fillRect(0, H - 28, W, 28);
          ctx!.font = "bold 8px monospace"; ctx!.fillStyle = "rgba(163,230,53,.35)";
          ctx!.fillText("PUBLIC LEDGER  |  ALL PLAYS TIMESTAMPED  |  NO DELETIONS", 16, H - 10);

          // History dots (bottom right)
          const dotY = H - 55;
          for (let i = 0; i < 20; i++) {
            const dx = W - 185 + i * 9;
            const isWin = i !== 4 && i !== 9 && i !== 15;
            ctx!.fillStyle = isWin ? "rgba(163,230,53,.3)" : "rgba(239,68,68,.3)";
            ctx!.beginPath(); ctx!.arc(dx, dotY, 2.5, 0, Math.PI * 2); ctx!.fill();
          }
          ctx!.font = "6px monospace"; ctx!.fillStyle = "rgba(255,255,255,.2)";
          ctx!.fillText("LAST 20 PLAYS", W - 185, dotY - 8);

          resRaf = requestAnimationFrame(drawPipeResults);
        }
        resRaf = requestAnimationFrame(drawPipeResults);
        cleanups.push(() => cancelAnimationFrame(resRaf));
      }
    }

    // ── SUMMARY funnel canvas ──
    const cvPipeSum = document.getElementById("cv-pipe-summary") as HTMLCanvasElement | null;
    if (cvPipeSum) {
      const ctx = cvPipeSum.getContext("2d");
      if (ctx) {
        const S = 200;
        let sumRaf = 0;
        function drawPipeSummary(t: number) {
          if (destroyed) return;
          const s = t * 0.001;
          ctx!.clearRect(0, 0, S, S);
          // Funnel shape
          const cx = S / 2, cy = S / 2;
          ctx!.globalCompositeOperation = "lighter";
          // Outer ring — all data
          ctx!.strokeStyle = "rgba(163,230,53,.08)"; ctx!.lineWidth = 8;
          ctx!.beginPath(); ctx!.arc(cx, cy, 80, 0, Math.PI * 2); ctx!.stroke();
          // Surviving arc
          const surviveAngle = Math.PI * 2 * 0.03;
          const rotation = s * 0.3;
          ctx!.strokeStyle = "rgba(163,230,53,.4)"; ctx!.lineWidth = 8;
          ctx!.beginPath(); ctx!.arc(cx, cy, 80, rotation, rotation + surviveAngle); ctx!.stroke();
          // Glow at arc tip
          const tipSx = cx + Math.cos(rotation + surviveAngle) * 80;
          const tipSy = cy + Math.sin(rotation + surviveAngle) * 80;
          const tg = ctx!.createRadialGradient(tipSx, tipSy, 0, tipSx, tipSy, 14);
          tg.addColorStop(0, "rgba(163,230,53,.3)"); tg.addColorStop(1, "transparent");
          ctx!.fillStyle = tg; ctx!.fillRect(tipSx - 14, tipSy - 14, 28, 28);
          // Inner rings
          ctx!.strokeStyle = "rgba(163,230,53,.04)"; ctx!.lineWidth = 1;
          ctx!.beginPath(); ctx!.arc(cx, cy, 60, 0, Math.PI * 2); ctx!.stroke();
          ctx!.beginPath(); ctx!.arc(cx, cy, 40, 0, Math.PI * 2); ctx!.stroke();
          ctx!.globalCompositeOperation = "source-over";
          sumRaf = requestAnimationFrame(drawPipeSummary);
        }
        sumRaf = requestAnimationFrame(drawPipeSummary);
        cleanups.push(() => cancelAnimationFrame(sumRaf));
      }
    }

    // ── Edge card canvases ──

    // FEEDS
    const cvFeeds = document.getElementById(
      "cv-feeds",
    ) as HTMLCanvasElement | null;
    if (cvFeeds) {
      const fCtx = cvFeeds.getContext("2d");
      if (fCtx) {
        const fW = 600,
          fH = 240;
        const tickers = [
          "SPX 5,642.30",
          "SPY 564.23",
          "QQQ 487.91",
          "NVDA 138.45",
          "AAPL 228.17",
          "TSLA 268.30",
          "META 612.44",
          "AMZN 198.55",
        ];
        const flowDots = Array.from({ length: 40 }, () => ({
          x: Math.random() * fW,
          y: Math.random() * fH,
          vx: 0.3 + Math.random() * 0.8,
          size: 1 + Math.random() * 2.5,
          bright: Math.random(),
        }));
        let tickOffset = 0;
        function drawFeeds(t: number) {
          if (destroyed) return;
          const s = t * 0.001;
          fCtx!.clearRect(0, 0, fW, fH);
          fCtx!.strokeStyle = "rgba(163,230,53,.06)";
          fCtx!.lineWidth = 0.5;
          for (let y = 0; y < fH; y += 30) {
            fCtx!.beginPath();
            fCtx!.moveTo(0, y);
            fCtx!.lineTo(fW, y);
            fCtx!.stroke();
          }
          for (let x = 0; x < fW; x += 60) {
            fCtx!.beginPath();
            fCtx!.moveTo(x, 0);
            fCtx!.lineTo(x, fH);
            fCtx!.stroke();
          }
          fCtx!.font = "11px monospace";
          tickOffset += 0.4;
          const totalW = tickers.length * 120;
          for (let i = 0; i < tickers.length * 2; i++) {
            const tx = ((i * 120 - tickOffset) % (totalW * 2)) + totalW;
            const mapped = (tx % (totalW * 2)) - totalW;
            if (mapped < -120 || mapped > fW + 20) continue;
            const flash = Math.sin(s * 2 + i) * 0.3 + 0.7;
            fCtx!.fillStyle = "rgba(163,230,53," + 0.5 * flash + ")";
            fCtx!.fillText(tickers[i % tickers.length], mapped, 22);
          }
          const tickers2 = [
            "GEX +2.4B",
            "DEX -890M",
            "VIX 14.2",
            "PUT/CALL 0.82",
            "FLOW ▲",
            "DPI 67%",
            "SWEEP 12K",
            "NET +$4.2M",
          ];
          for (let i = 0; i < tickers2.length * 2; i++) {
            const tx =
              ((i * 110 - tickOffset * 0.7 + 200) % (totalW * 2)) + totalW;
            const mapped = (tx % (totalW * 2)) - totalW;
            if (mapped < -120 || mapped > fW + 20) continue;
            fCtx!.fillStyle = "rgba(163,230,53,.3)";
            fCtx!.fillText(tickers2[i % tickers2.length], mapped, 44);
          }
          fCtx!.globalCompositeOperation = "lighter";
          for (const d of flowDots) {
            d.x += d.vx;
            if (d.x > fW + 5) d.x = -5;
            const pulse = 0.4 + Math.sin(s * 3 + d.bright * 6) * 0.3;
            fCtx!.globalAlpha = pulse * d.bright;
            fCtx!.fillStyle = "#a3e635";
            fCtx!.beginPath();
            fCtx!.arc(d.x, d.y, d.size, 0, Math.PI * 2);
            fCtx!.fill();
            fCtx!.globalAlpha = pulse * d.bright * 0.2;
            fCtx!.beginPath();
            fCtx!.arc(d.x, d.y, d.size * 4, 0, Math.PI * 2);
            fCtx!.fill();
          }
          fCtx!.globalCompositeOperation = "source-over";
          fCtx!.globalAlpha = 1;
          for (let i = 0; i < 25; i++) {
            const bx = 20 + i * 22;
            const bh =
              20 +
              Math.sin(s * 0.5 + i * 0.4) * 15 +
              Math.sin(s * 1.2 + i * 0.7) * 10;
            const by = fH - 20 - bh;
            const green = Math.sin(s + i * 0.3) > 0;
            fCtx!.fillStyle = green
              ? "rgba(163,230,53,.25)"
              : "rgba(239,68,68,.2)";
            fCtx!.fillRect(bx, by, 14, bh);
            fCtx!.fillStyle = green
              ? "rgba(163,230,53,.5)"
              : "rgba(239,68,68,.4)";
            fCtx!.fillRect(
              bx + 6,
              by - 3 - Math.random() * 8,
              2,
              6 + Math.random() * 8,
            );
          }
          feedsRaf = requestAnimationFrame(drawFeeds);
        }
        feedsRaf = requestAnimationFrame(drawFeeds);
        cleanups.push(() => cancelAnimationFrame(feedsRaf));
      }
    }

    // LATENCY
    const cvLat = document.getElementById(
      "cv-latency",
    ) as HTMLCanvasElement | null;
    if (cvLat) {
      const lCtx = cvLat.getContext("2d");
      if (lCtx) {
        const lW = 600,
          lH = 240;
        const packets = Array.from({ length: 8 }, (_, i) => ({
          x: -20 - i * 80,
          y: 40 + Math.random() * 160,
          speed: 2 + Math.random() * 3,
          size: 3,
        }));
        const signalY = [60, 100, 140, 180];
        function drawLatency(t: number) {
          if (destroyed) return;
          const s = t * 0.001;
          lCtx!.clearRect(0, 0, lW, lH);
          for (let i = 0; i < signalY.length; i++) {
            const y = signalY[i];
            lCtx!.strokeStyle = "rgba(34,211,238,.08)";
            lCtx!.lineWidth = 1;
            lCtx!.beginPath();
            lCtx!.moveTo(0, y);
            lCtx!.lineTo(lW, y);
            lCtx!.stroke();
            lCtx!.strokeStyle = "rgba(34,211,238,.3)";
            lCtx!.lineWidth = 1.5;
            lCtx!.beginPath();
            for (let x = 0; x < lW; x += 2) {
              const wave =
                Math.sin(x * 0.02 - s * 3 + i * 1.5) * 8 +
                Math.sin(x * 0.05 - s * 5 + i) * 3;
              if (x === 0) lCtx!.moveTo(x, y + wave);
              else lCtx!.lineTo(x, y + wave);
            }
            lCtx!.stroke();
          }
          lCtx!.globalCompositeOperation = "lighter";
          for (const p of packets) {
            p.x += p.speed;
            if (p.x > lW + 20) {
              p.x = -20;
              p.y = signalY[Math.floor(Math.random() * 4)];
            }
            const glow = lCtx!.createRadialGradient(
              p.x,
              p.y,
              0,
              p.x,
              p.y,
              12,
            );
            glow.addColorStop(0, "rgba(34,211,238,.8)");
            glow.addColorStop(0.4, "rgba(34,211,238,.3)");
            glow.addColorStop(1, "transparent");
            lCtx!.fillStyle = glow;
            lCtx!.fillRect(p.x - 12, p.y - 12, 24, 24);
            lCtx!.strokeStyle = "rgba(34,211,238,.15)";
            lCtx!.lineWidth = 2;
            lCtx!.beginPath();
            lCtx!.moveTo(p.x, p.y);
            lCtx!.lineTo(p.x - 30, p.y);
            lCtx!.stroke();
          }
          lCtx!.globalCompositeOperation = "source-over";
          lCtx!.font = "bold 18px monospace";
          lCtx!.fillStyle = "rgba(34,211,238,.7)";
          const latMs = (Math.sin(s) * 2 + 2).toFixed(1);
          lCtx!.fillText(latMs + "ms", lW - 80, lH - 20);
          lCtx!.font = "9px monospace";
          lCtx!.fillStyle = "rgba(34,211,238,.4)";
          lCtx!.fillText("LATENCY", lW - 80, lH - 35);
          const nodes: [number, number][] = [
            [50, 50],
            [150, 180],
            [300, 70],
            [450, 160],
            [550, 90],
          ];
          for (let i = 0; i < nodes.length; i++) {
            const [nx, ny] = nodes[i];
            const pulse = 0.3 + Math.sin(s * 2 + i) * 0.2;
            lCtx!.fillStyle = "rgba(34,211,238," + pulse + ")";
            lCtx!.beginPath();
            lCtx!.arc(nx, ny, 3, 0, Math.PI * 2);
            lCtx!.fill();
            if (i < nodes.length - 1) {
              lCtx!.strokeStyle = "rgba(34,211,238,.06)";
              lCtx!.lineWidth = 0.5;
              lCtx!.beginPath();
              lCtx!.moveTo(nx, ny);
              lCtx!.lineTo(nodes[i + 1][0], nodes[i + 1][1]);
              lCtx!.stroke();
            }
          }
          latencyRaf = requestAnimationFrame(drawLatency);
        }
        latencyRaf = requestAnimationFrame(drawLatency);
        cleanups.push(() => cancelAnimationFrame(latencyRaf));
      }
    }

    // INTEL
    const cvIntel = document.getElementById(
      "cv-intel",
    ) as HTMLCanvasElement | null;
    if (cvIntel) {
      const iCtx = cvIntel.getContext("2d");
      if (iCtx) {
        const iW = 600,
          iH = 240;
        const layers = [3, 5, 6, 5, 3];
        const neuronPos: Array<{
          x: number;
          y: number;
          layer: number;
          fire: number;
        }> = [];
        layers.forEach((count, li) => {
          const x = 60 + (li * (iW - 120)) / (layers.length - 1);
          for (let ni = 0; ni < count; ni++) {
            const y = iH / 2 + (ni - (count - 1) / 2) * 32;
            neuronPos.push({
              x,
              y,
              layer: li,
              fire: Math.random() * Math.PI * 2,
            });
          }
        });
        const connections: Array<{
          from: (typeof neuronPos)[0];
          to: (typeof neuronPos)[0];
          phase: number;
        }> = [];
        for (let li = 0; li < layers.length - 1; li++) {
          const curr = neuronPos.filter((n) => n.layer === li);
          const next = neuronPos.filter((n) => n.layer === li + 1);
          for (const c of curr)
            for (const n of next)
              connections.push({ from: c, to: n, phase: Math.random() * 6 });
        }
        function drawIntel(t: number) {
          if (destroyed) return;
          const s = t * 0.001;
          iCtx!.clearRect(0, 0, iW, iH);
          for (const c of connections) {
            const signal = Math.max(0, Math.sin(s * 1.5 + c.phase));
            if (signal < 0.3) {
              iCtx!.strokeStyle = "rgba(191,95,255,.03)";
            } else {
              iCtx!.strokeStyle =
                "rgba(191,95,255," + signal * 0.15 + ")";
            }
            iCtx!.lineWidth = signal > 0.7 ? 1.5 : 0.5;
            iCtx!.beginPath();
            iCtx!.moveTo(c.from.x, c.from.y);
            iCtx!.lineTo(c.to.x, c.to.y);
            iCtx!.stroke();
            if (signal > 0.6) {
              const prog = (s * 2 + c.phase) % 1;
              const px = c.from.x + (c.to.x - c.from.x) * prog;
              const py = c.from.y + (c.to.y - c.from.y) * prog;
              iCtx!.fillStyle =
                "rgba(191,95,255," + signal * 0.4 + ")";
              iCtx!.beginPath();
              iCtx!.arc(px, py, 1.5, 0, Math.PI * 2);
              iCtx!.fill();
            }
          }
          iCtx!.globalCompositeOperation = "lighter";
          for (const n of neuronPos) {
            const fire = 0.3 + Math.sin(s * 2 + n.fire) * 0.3;
            const glow = iCtx!.createRadialGradient(
              n.x,
              n.y,
              0,
              n.x,
              n.y,
              14,
            );
            glow.addColorStop(0, "rgba(191,95,255," + fire * 0.8 + ")");
            glow.addColorStop(0.5, "rgba(191,95,255," + fire * 0.2 + ")");
            glow.addColorStop(1, "transparent");
            iCtx!.fillStyle = glow;
            iCtx!.fillRect(n.x - 14, n.y - 14, 28, 28);
            iCtx!.fillStyle = "rgba(191,95,255," + fire + ")";
            iCtx!.beginPath();
            iCtx!.arc(n.x, n.y, 3, 0, Math.PI * 2);
            iCtx!.fill();
          }
          iCtx!.globalCompositeOperation = "source-over";
          iCtx!.font = "8px monospace";
          iCtx!.fillStyle = "rgba(191,95,255,.4)";
          const labels = ["INPUT", "FLOW", "CORTEX", "VERIFY", "SIGNAL"];
          labels.forEach((l, i) => {
            const x = 60 + (i * (iW - 120)) / (layers.length - 1);
            iCtx!.fillText(l, x - 12, iH - 12);
          });
          iCtx!.font = "bold 16px monospace";
          iCtx!.fillStyle = "rgba(191,95,255,.6)";
          const score = (3 + Math.sin(s * 0.3) * 1.5).toFixed(1);
          iCtx!.fillText("CONFLUENCE: " + score + "/5", iW - 200, 24);
          intelRaf = requestAnimationFrame(drawIntel);
        }
        intelRaf = requestAnimationFrame(drawIntel);
        cleanups.push(() => cancelAnimationFrame(intelRaf));
      }
    }

    // SURFACE
    const cvSurf = document.getElementById(
      "cv-surface",
    ) as HTMLCanvasElement | null;
    if (cvSurf) {
      const sCtx = cvSurf.getContext("2d");
      if (sCtx) {
        const sW = 600,
          sH = 240;
        const modules = [
          { name: "SPX SLAYER", color: "#a3e635", x: 10, y: 10, w: 185, h: 105 },
          { name: "HELIX FLOW", color: "#22d3ee", x: 205, y: 10, w: 185, h: 105 },
          { name: "THERMAL", color: "#f97316", x: 400, y: 10, w: 190, h: 105 },
          { name: "LARGO AI", color: "#bf5fff", x: 10, y: 125, w: 185, h: 105 },
          { name: "NIGHT HAWK", color: "#ef4444", x: 205, y: 125, w: 185, h: 105 },
          { name: "VECTOR", color: "#3b82f6", x: 400, y: 125, w: 190, h: 105 },
        ];
        function drawSurface(t: number) {
          if (destroyed) return;
          const s = t * 0.001;
          sCtx!.clearRect(0, 0, sW, sH);
          for (let i = 0; i < modules.length; i++) {
            const m = modules[i];
            const pulse = 0.5 + Math.sin(s + i * 1.1) * 0.15;
            sCtx!.fillStyle = "rgba(255,255,255,.02)";
            sCtx!.beginPath();
            sCtx!.roundRect(m.x, m.y, m.w, m.h, 8);
            sCtx!.fill();
            const hex = m.color;
            const hr = parseInt(hex.slice(1, 3), 16),
              hg = parseInt(hex.slice(3, 5), 16),
              hb = parseInt(hex.slice(5, 7), 16);
            sCtx!.strokeStyle =
              "rgba(" + hr + "," + hg + "," + hb + "," + 0.15 * pulse + ")";
            sCtx!.lineWidth = 1;
            sCtx!.beginPath();
            sCtx!.roundRect(m.x, m.y, m.w, m.h, 8);
            sCtx!.stroke();
            sCtx!.fillStyle =
              "rgba(" + hr + "," + hg + "," + hb + "," + 0.5 * pulse + ")";
            sCtx!.fillRect(m.x + 8, m.y, m.w - 16, 1.5);
            sCtx!.font = "bold 9px monospace";
            sCtx!.fillStyle =
              "rgba(" + hr + "," + hg + "," + hb + "," + 0.7 + ")";
            sCtx!.fillText(m.name, m.x + 10, m.y + 18);
            sCtx!.fillStyle =
              "rgba(" + hr + "," + hg + "," + hb + "," + pulse + ")";
            sCtx!.beginPath();
            sCtx!.arc(m.x + m.w - 14, m.y + 15, 3, 0, Math.PI * 2);
            sCtx!.fill();
            sCtx!.strokeStyle =
              "rgba(" + hr + "," + hg + "," + hb + "," + 0.25 + ")";
            sCtx!.lineWidth = 1;
            sCtx!.beginPath();
            for (let x = 0; x < m.w - 20; x += 3) {
              const cy =
                m.y +
                55 +
                Math.sin(x * 0.05 + s * 1.5 + i * 2) * 18 +
                Math.sin(x * 0.12 + s * 2.5 + i) * 8;
              if (x === 0) sCtx!.moveTo(m.x + 10 + x, cy);
              else sCtx!.lineTo(m.x + 10 + x, cy);
            }
            sCtx!.stroke();
            sCtx!.font = "11px monospace";
            sCtx!.fillStyle =
              "rgba(" + hr + "," + hg + "," + hb + "," + 0.5 + ")";
            const val = (100 + Math.sin(s * 0.7 + i * 3) * 50).toFixed(1);
            sCtx!.fillText(val, m.x + 10, m.y + m.h - 12);
            sCtx!.font = "7px monospace";
            sCtx!.fillStyle = "rgba(255,255,255,.2)";
            sCtx!.fillText("ACTIVE", m.x + m.w - 42, m.y + m.h - 12);
          }
          surfaceRaf = requestAnimationFrame(drawSurface);
        }
        surfaceRaf = requestAnimationFrame(drawSurface);
        cleanups.push(() => cancelAnimationFrame(surfaceRaf));
      }
    }

    // ── Gallery/carousel with lightbox ──
    const galleries = document.querySelectorAll(".cmd-gallery");
    if (galleries.length) {
      const lb = document.createElement("div");
      lb.className = "gal-lightbox";
      lb.innerHTML =
        '<button class="gal-lb-close">&times;</button><button class="gal-lb-arrow gal-lb-prev">&#8249;</button><img class="gal-lb-img" src="" alt="BlackOut desk screenshot"><button class="gal-lb-arrow gal-lb-next">&#8250;</button><div class="gal-lb-dots"></div>';
      document.body.appendChild(lb);
      cleanups.push(() => { document.body.style.overflow = ""; lb.remove(); });

      const lbImg = lb.querySelector(".gal-lb-img") as HTMLImageElement;
      const lbDots = lb.querySelector(".gal-lb-dots") as HTMLElement;
      let lbGallery: Element | null = null,
        lbIndex = 0;

      function closeLightbox() {
        lb.classList.remove("gal-lb-open");
        document.body.style.overflow = "";
      }
      lb.querySelector(".gal-lb-close")!.addEventListener(
        "click",
        closeLightbox,
      );
      lb.addEventListener("click", (e) => {
        if (e.target === lb) closeLightbox();
      });

      function updateLightbox() {
        if (!lbGallery) return;
        const slides = lbGallery.querySelectorAll(
          ".gal-slide img",
        ) as NodeListOf<HTMLImageElement>;
        if (!slides.length) return;
        lbIndex =
          ((lbIndex % slides.length) + slides.length) % slides.length;
        lbImg.src = slides[lbIndex].src;
        lbImg.alt = slides[lbIndex].alt;
        lbDots.innerHTML = "";
        slides.forEach((_, i) => {
          const d = document.createElement("span");
          d.className =
            "gal-dot" + (i === lbIndex ? " gal-dot-active" : "");
          d.addEventListener("click", () => {
            lbIndex = i;
            updateLightbox();
          });
          lbDots.appendChild(d);
        });
      }
      function navLightbox(dir: number) {
        lbIndex += dir;
        updateLightbox();
      }
      function openLightbox(gallery: Element, idx: number) {
        lbGallery = gallery;
        lbIndex = idx;
        updateLightbox();
        lb.classList.add("gal-lb-open");
        document.body.style.overflow = "hidden";
      }

      const keydownHandler = (e: KeyboardEvent) => {
        if (!lb.classList.contains("gal-lb-open")) return;
        if (e.key === "Escape") closeLightbox();
        if (e.key === "ArrowLeft") navLightbox(-1);
        if (e.key === "ArrowRight") navLightbox(1);
      };
      document.addEventListener("keydown", keydownHandler);
      cleanups.push(() =>
        document.removeEventListener("keydown", keydownHandler),
      );

      lb.querySelector(".gal-lb-prev")!.addEventListener("click", (e) => {
        e.stopPropagation();
        navLightbox(-1);
      });
      lb.querySelector(".gal-lb-next")!.addEventListener("click", (e) => {
        e.stopPropagation();
        navLightbox(1);
      });

      let lbTouchX = 0;
      lb.addEventListener(
        "touchstart",
        (e) => {
          lbTouchX = e.touches[0].clientX;
        },
        { passive: true },
      );
      lb.addEventListener("touchend", (e) => {
        const dx = e.changedTouches[0].clientX - lbTouchX;
        if (Math.abs(dx) > 40) {
          navLightbox(dx < 0 ? 1 : -1);
        }
      });

      galleries.forEach((gal) => {
        const slides = gal.querySelectorAll(".gal-slide");
        const dots = gal.querySelector(".gal-dots");
        const prev = gal.querySelector(".gal-prev") as HTMLElement | null;
        const next = gal.querySelector(".gal-next") as HTMLElement | null;
        if (slides.length <= 1) {
          if (prev) prev.style.display = "none";
          if (next) next.style.display = "none";
          if (dots) (dots as HTMLElement).style.display = "none";
        }
        let current = 0;
        let autoTimer: ReturnType<typeof setInterval> | null = null;
        const AUTO_INTERVAL = 4000;

        function goTo(idx: number) {
          current =
            ((idx % slides.length) + slides.length) % slides.length;
          slides.forEach((s, i) => {
            s.classList.toggle("gal-active", i === current);
          });
          if (dots) {
            const dotEls = dots.querySelectorAll(".gal-dot");
            dotEls.forEach((d, i) =>
              d.classList.toggle("gal-dot-active", i === current),
            );
          }
        }
        function startAuto() {
          stopAuto();
          if (slides.length > 1) {
            autoTimer = setInterval(
              () => goTo(current + 1),
              AUTO_INTERVAL,
            );
          }
        }
        function stopAuto() {
          if (autoTimer) {
            clearInterval(autoTimer);
            autoTimer = null;
          }
        }

        if (prev)
          prev.addEventListener("click", (e) => {
            e.stopPropagation();
            goTo(current - 1);
            startAuto();
          });
        if (next)
          next.addEventListener("click", (e) => {
            e.stopPropagation();
            goTo(current + 1);
            startAuto();
          });

        if (dots) {
          dots.querySelectorAll(".gal-dot").forEach((d, i) => {
            d.addEventListener("click", (e) => {
              e.stopPropagation();
              goTo(i);
              startAuto();
            });
          });
        }

        gal.addEventListener("mouseenter", stopAuto);
        gal.addEventListener("mouseleave", startAuto);

        let touchX = 0;
        gal.addEventListener(
          "touchstart",
          (e) => {
            touchX = (e as TouchEvent).touches[0].clientX;
            stopAuto();
          },
          { passive: true },
        );
        gal.addEventListener("touchend", (e) => {
          const dx = (e as TouchEvent).changedTouches[0].clientX - touchX;
          if (Math.abs(dx) > 30) {
            goTo(current + (dx < 0 ? 1 : -1));
          }
          startAuto();
        });

        const galTrack = gal.querySelector(".gal-track");
        if (galTrack) {
          galTrack.addEventListener("click", () => {
            openLightbox(gal, current);
          });
        }

        startAuto();
        cleanups.push(() => stopAuto());
      });
    }

    // ── Carousel navigation ──
    const track = document.getElementById("cmd-track");
    const dots = document.querySelectorAll(".cmd-dot");
    const prevBtn = document.getElementById("cmd-prev");
    const nextBtn = document.getElementById("cmd-next");
    if (track && prevBtn && nextBtn) {
      const cardW = 420 + 28;
      function scrollToCard(i: number) {
        track!.scrollTo({ left: i * cardW, behavior: "smooth" });
      }
      function updateDots() {
        const sl = track!.scrollLeft;
        const idx = Math.round(sl / cardW);
        dots.forEach((d, i) => d.classList.toggle("active", i === idx));
      }
      const prevHandler = () => {
        track!.scrollBy({ left: -cardW, behavior: "smooth" });
      };
      const nextHandler = () => {
        track!.scrollBy({ left: cardW, behavior: "smooth" });
      };
      prevBtn.addEventListener("click", prevHandler);
      nextBtn.addEventListener("click", nextHandler);
      cleanups.push(() => {
        prevBtn!.removeEventListener("click", prevHandler);
        nextBtn!.removeEventListener("click", nextHandler);
      });
      dots.forEach((d, i) => {
        const handler = () => scrollToCard(i);
        d.addEventListener("click", handler);
        cleanups.push(() => d.removeEventListener("click", handler));
      });
      track.addEventListener("scroll", updateDots, { passive: true });
      cleanups.push(() => track!.removeEventListener("scroll", updateDots));

    }

    // ── Carousel atmospheric background ──
    const cmdBg = document.getElementById(
      "cmd-bg",
    ) as HTMLCanvasElement | null;
    if (cmdBg) {
      const bx = cmdBg.getContext("2d");
      if (bx) {
        let bW = 0,
          bH = 0;
        function resizeCmdBg() {
          const r = cmdBg!.parentElement!.getBoundingClientRect();
          bW = cmdBg!.width = r.width;
          bH = cmdBg!.height = r.height;
        }
        resizeCmdBg();
        const cmdBgResizeHandler = () => resizeCmdBg();
        window.addEventListener("resize", cmdBgResizeHandler);
        cleanups.push(() =>
          window.removeEventListener("resize", cmdBgResizeHandler),
        );
        const gridParts = Array.from({ length: 60 }, () => ({
          x: Math.random() * 2000,
          y: Math.random() * 2000,
          vx: (Math.random() - 0.5) * 0.1,
          vy: (Math.random() - 0.5) * 0.08,
          r: Math.random() * 1.5 + 0.3,
          a: Math.random() * 0.15 + 0.03,
        }));
        let cmdBgRaf = 0;
        function drawCmdBg(t: number) {
          if (destroyed) return;
          bx!.clearRect(0, 0, bW, bH);
          const gOff = (t * 0.008) % 40;
          bx!.strokeStyle = "rgba(163,230,53,.018)";
          bx!.lineWidth = 0.5;
          for (let x = gOff; x < bW; x += 40) {
            bx!.beginPath();
            bx!.moveTo(x, 0);
            bx!.lineTo(x, bH);
            bx!.stroke();
          }
          for (let y = gOff; y < bH; y += 40) {
            bx!.beginPath();
            bx!.moveTo(0, y);
            bx!.lineTo(bW, y);
            bx!.stroke();
          }
          gridParts.forEach((p) => {
            p.x += p.vx;
            p.y += p.vy;
            if (p.x < 0) p.x = bW;
            if (p.x > bW) p.x = 0;
            if (p.y < 0) p.y = bH;
            if (p.y > bH) p.y = 0;
            bx!.beginPath();
            bx!.arc(p.x % bW, p.y % bH, p.r, 0, Math.PI * 2);
            bx!.fillStyle = "rgba(163,230,53," + p.a + ")";
            bx!.fill();
          });
          cmdBgRaf = requestAnimationFrame(drawCmdBg);
        }
        cmdBgRaf = requestAnimationFrame(drawCmdBg);
        cleanups.push(() => cancelAnimationFrame(cmdBgRaf));
      }
    }

    // ── Scroll pulse into spine ──
    let lastScroll = 0;
    const spine = document.querySelector(".spine") as HTMLElement | null;
    if (spine) {
      const scrollHandler = () => {
        const st = window.scrollY;
        if (st > lastScroll + 100) {
          const pulse = document.createElement("div");
          pulse.style.cssText =
            "position:absolute;left:-2px;top:0;width:5px;height:30px;background:linear-gradient(180deg,transparent,#a3e635,transparent);box-shadow:0 0 10px #a3e635;animation:spulse 2s linear forwards;pointer-events:none";
          spine!.appendChild(pulse);
          setTimeout(() => pulse.remove(), 2200);
          lastScroll = st;
        }
      };
      window.addEventListener("scroll", scrollHandler);
      cleanups.push(() =>
        window.removeEventListener("scroll", scrollHandler),
      );
    }

    // ── Energy ring cursor tracking ──
    const cards = document.querySelectorAll(".cmd-card");
    const ringState = new Map<
      Element,
      {
        mx: number;
        my: number;
        angle: number;
        active: boolean;
        raf: number | null;
      }
    >();

    function ringTick(card: Element) {
      const s = ringState.get(card);
      if (!s || !s.active || destroyed) {
        if (s) s.raf = null;
        return;
      }
      const cxR = s.mx - 0.5;
      const cyR = s.my - 0.5;
      const targetAngle = Math.atan2(cyR, cxR) * (180 / Math.PI) + 90;
      let diff = targetAngle - s.angle;
      while (diff > 180) diff -= 360;
      while (diff < -180) diff += 360;
      s.angle += diff * 0.12;
      const pctX = (s.mx * 100).toFixed(1) + "%";
      const pctY = (s.my * 100).toFixed(1) + "%";
      (card as HTMLElement).style.setProperty("--mx", pctX);
      (card as HTMLElement).style.setProperty("--my", pctY);
      (card as HTMLElement).style.setProperty(
        "--ring-angle",
        s.angle.toFixed(1) + "deg",
      );
      const ring = card.querySelector(
        ".cmd-ring-track",
      ) as HTMLElement | null;
      if (ring)
        ring.style.background = `conic-gradient(from ${s.angle.toFixed(1)}deg, color-mix(in srgb, var(--ac) 90%, white) 0deg, color-mix(in srgb, var(--ac) 40%, transparent) 50deg, transparent 120deg, transparent 240deg, color-mix(in srgb, var(--ac) 10%, transparent) 310deg, color-mix(in srgb, var(--ac) 90%, white) 360deg)`;
      s.raf = requestAnimationFrame(() => ringTick(card));
    }

    cards.forEach((card) => {
      ringState.set(card, {
        mx: 0.5,
        my: 0.5,
        angle: 0,
        active: false,
        raf: null,
      });
      const enterHandler = () => {
        const s = ringState.get(card)!;
        s.active = true;
        if (!s.raf) ringTick(card);
      };
      const leaveHandler = () => {
        const s = ringState.get(card)!;
        s.active = false;
      };
      const moveHandler = (e: Event) => {
        const me = e as MouseEvent;
        const rect = (card as HTMLElement).getBoundingClientRect();
        const s = ringState.get(card)!;
        s.mx = (me.clientX - rect.left) / rect.width;
        s.my = (me.clientY - rect.top) / rect.height;
      };
      card.addEventListener("mouseenter", enterHandler);
      card.addEventListener("mouseleave", leaveHandler);
      card.addEventListener("mousemove", moveHandler);
      cleanups.push(() => {
        card.removeEventListener("mouseenter", enterHandler);
        card.removeEventListener("mouseleave", leaveHandler);
        card.removeEventListener("mousemove", moveHandler);
        const s = ringState.get(card);
        if (s && s.raf) cancelAnimationFrame(s.raf);
      });
    });

    // ── Mobile sticky CTA — show when hero CTA scrolls out of view, but never
    // over FAQ rows or the footer (expanded accordions push targets into the bar's
    // fixed footprint — FINDINGS P2 #2799).
    const heroCta = document.querySelector(".hero .cta-row");
    const stickyCta = document.getElementById("mobile-sticky-cta");
    if (heroCta && stickyCta) {
      let heroPast = false;

      const readRects = () => {
        const stickyRect = stickyCta.getBoundingClientRect();
        const faqRects = Array.from(document.querySelectorAll(".sec-faq .faq-item")).map((el) =>
          el.getBoundingClientRect()
        );
        const footer = document.querySelector(".footer");
        const footerRect = footer ? footer.getBoundingClientRect() : null;
        return { stickyRect, faqRects, footerRect };
      };

      const syncSticky = () => {
        const { stickyRect, faqRects, footerRect } = readRects();
        const blocked = mobileStickyBlockedByContent(stickyRect, faqRects, footerRect);
        stickyCta.classList.toggle("visible", shouldShowMobileStickyCta(heroPast, blocked));
      };

      const stickyObs = new IntersectionObserver(
        ([entry]) => {
          heroPast = !entry.isIntersecting;
          syncSticky();
        },
        { threshold: 0 }
      );
      stickyObs.observe(heroCta);

      const onFaqToggle = (e: Event) => {
        const t = e.target;
        if (t instanceof HTMLElement && t.closest(".sec-faq .faq-item")) {
          requestAnimationFrame(syncSticky);
        }
      };
      document.addEventListener("toggle", onFaqToggle, true);

      let scrollRaf = 0;
      const onScroll = () => {
        if (scrollRaf) return;
        scrollRaf = requestAnimationFrame(() => {
          scrollRaf = 0;
          syncSticky();
        });
      };
      window.addEventListener("scroll", onScroll, { passive: true });

      cleanups.push(() => {
        stickyObs.disconnect();
        document.removeEventListener("toggle", onFaqToggle, true);
        window.removeEventListener("scroll", onScroll);
        if (scrollRaf) cancelAnimationFrame(scrollRaf);
      });
    }

    return () => {
      destroyed = true;
      cleanups.forEach((fn) => fn());
    };
  }, []);

  return null;
}
