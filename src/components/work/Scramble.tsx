"use client";
import { useEffect, useState } from "react";

const GLYPHS = "!<>-_\\/[]{}=+*^?#ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

/* Decodes `text` left to right out of random glyphs. Remount it (key=...) to replay for new text. */
export default function Scramble({ text, duration = 800, delay = 0, className }: { text: string; duration?: number; delay?: number; className?: string }) {
  const [out, setOut] = useState(text);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let raf = 0;
    const t0 = performance.now() + delay;
    const tick = (now: number) => {
      const p = Math.min(1, Math.max(0, (now - t0) / duration));
      const keep = Math.floor(p * text.length);
      let s = "";
      for (let i = 0; i < text.length; i++) s += text[i] === " " || i < keep ? text[i] : GLYPHS[Math.floor(Math.random() * GLYPHS.length)];
      setOut(s);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [text, duration, delay]);

  return (
    <span className={className} aria-label={text}>
      <span aria-hidden="true">{out}</span>
    </span>
  );
}