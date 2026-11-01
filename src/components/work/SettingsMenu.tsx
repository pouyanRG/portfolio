"use client";
import { useEffect, useRef, useState } from "react";
import s from "./WorkGallery.module.css";
import type { Quality } from "./scene";

export const QUALITY_LABEL = ["Low", "Medium", "High"] as const;
const N_BARS = 9;

/* Header equalizer: moves with the real audio analyser while sound is on, rests as a flat comb when it is off. */
export function Equalizer({ on, levels }: { on: boolean; levels: (n: number) => number[] }) {
  const bars = useRef<(HTMLSpanElement | null)[]>([]);
  useEffect(() => {
    const apply = (fn: (i: number) => number) => bars.current.forEach((el, i) => { if (el) el.style.transform = `scaleY(${fn(i)})`; });
    if (!on) { apply((i) => 0.55 + 0.1 * ((i * 5) % 4)); return; }
    let raf = 0;
    const loop = (t: number) => {
      const lv = levels(N_BARS);
      apply((i) => Math.min(1, 0.2 + (lv[i] ?? 0) * 1.5 + 0.28 * Math.abs(Math.sin(t / 240 + i * 1.7))));
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [on, levels]);

  return (
    <span className={s.eq} aria-hidden="true">
      {Array.from({ length: N_BARS }, (_, i) => (<span key={i} ref={(el) => { bars.current[i] = el; }} />))}
    </span>
  );
}

type Props = {
  sound: boolean; onSound(v: boolean): void;
  dark: boolean; onDark(v: boolean): void;
  quality: Quality; onQuality(q: Quality): void;
};

const Switch = ({ on }: { on: boolean }) => <span className={on ? s.swOn : s.sw} aria-hidden="true"><i /></span>;

export default function SettingsMenu({ sound, onSound, dark, onDark, quality, onQuality }: Props) {
  const [open, setOpen] = useState(false);
  const [sub, setSub] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) { setOpen(false); setSub(false); } };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpen(false); setSub(false); } };
    window.addEventListener("pointerdown", away); window.addEventListener("keydown", esc);
    return () => { window.removeEventListener("pointerdown", away); window.removeEventListener("keydown", esc); };
  }, [open]);

  return (
    <div ref={box} className={s.settings}>
      <button className={s.settingsBtn} aria-expanded={open} aria-haspopup="menu" onClick={() => { setOpen((v) => !v); setSub(false); }}>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
        </svg>
        Settings
      </button>
      {open && (
        <div className={s.smenu} role="menu">
          <div className={s.mhead}>Settings</div>
          <button role="menuitemcheckbox" aria-checked={sound} className={s.mrow} onClick={() => onSound(!sound)}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M11 5 6 9H2v6h4l5 4z" /><path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14" /></svg>
            <span>Sound</span><Switch on={sound} />
          </button>
          <button role="menuitemcheckbox" aria-checked={dark} className={s.mrow} onClick={() => onDark(!dark)}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>
            <span>Dark mode</span><Switch on={dark} />
          </button>
          <div className={s.qwrap} onMouseLeave={() => setSub(false)}>
            <button role="menuitem" aria-haspopup="menu" aria-expanded={sub} className={s.mrow} onMouseEnter={() => setSub(true)} onClick={() => setSub((v) => !v)}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="M4 18a8 8 0 1 1 16 0" /><path d="m12 18 4-6" /></svg>
              <span>Quality</span><em>{QUALITY_LABEL[quality]}</em><b aria-hidden="true">›</b>
            </button>
            {sub && (
              <div className={s.qsub} role="menu">
                {QUALITY_LABEL.map((l, i) => (
                  <button key={l} role="menuitemradio" aria-checked={quality === i} className={quality === i ? s.subOn : s.sub} onClick={() => { onQuality(i as Quality); setSub(false); }}>{l}</button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
