"use client";
import { useEffect, useRef } from "react";

export default function Particles() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current!;
    const ctx = canvas.getContext("2d")!;
    let raf = 0;
    type P = { x: number; y: number; r: number; vx: number; vy: number };
    let ps: P[] = [];

    const init = () => {
      canvas.width = innerWidth; canvas.height = innerHeight;
      ps = Array.from({ length: (canvas.width * canvas.height) / 12000 }, () => ({
        x: Math.random() * canvas.width, y: Math.random() * canvas.height,
        r: Math.random() * 2 + 0.5, vx: Math.random() - 0.5, vy: Math.random() - 0.5,
      }));
    };
    const loop = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = "rgba(255,255,255,.4)";
      for (const p of ps) {
        p.x += p.vx; p.y += p.vy;
        if (p.x < 0 || p.x > canvas.width) p.vx *= -1;
        if (p.y < 0 || p.y > canvas.height) p.vy *= -1;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
      }
      raf = requestAnimationFrame(loop);
    };
    init(); loop();
    addEventListener("resize", init);
    return () => { cancelAnimationFrame(raf); removeEventListener("resize", init); };
  }, []);

  return <canvas ref={ref} className="pointer-events-none fixed inset-0 -z-10 opacity-80" />;
}