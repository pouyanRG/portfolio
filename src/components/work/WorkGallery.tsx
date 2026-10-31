"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Project } from "@/lib/projects";
import { createWorkScene, type Quality, type SceneApi } from "./scene";
import { createAudio, type SiteAudio } from "./audio";
import Scramble from "./Scramble";
import SettingsMenu, { Equalizer } from "./SettingsMenu";
import s from "./WorkGallery.module.css";

const pad = (n: number) => String(n).padStart(2, "0");
type Facet = "emotion" | "category";
type Filters = Record<Facet, string>;
const ALL: Filters = { emotion: "All", category: "All" };

const FacetIcon = ({ k }: { k: Facet }) => k === "emotion"
  ? (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z" /><path d="M19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z" /></svg>)
  : (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m12 3 9 5-9 5-9-5z" /><path d="m3 13 9 5 9-5" /></svg>);

export default function WorkGallery({ projects }: { projects: Project[] }) {
  const router = useRouter();
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const apiRef = useRef<SceneApi | null>(null);
  const audioRef = useRef<SiteAudio | null>(null);
  const [filters, setFilters] = useState<Filters>(ALL);
  const [menu, setMenu] = useState(false);
  const [facet, setFacet] = useState<Facet | null>(null);
  const [active, setActive] = useState(0);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [sound, setSound] = useState(false);
  const [dark, setDark] = useState(true);
  const [quality, setQuality] = useState<Quality>(() => (typeof window !== "undefined" && window.innerWidth < 700 ? 1 : 2));
  const qualityRef = useRef(quality);
  useEffect(() => { qualityRef.current = quality; });

  const options = useMemo<Record<Facet, string[]>>(() => ({
    category: ["All", ...Array.from(new Set(projects.map((p) => p.category).filter(Boolean)))],
    emotion: ["All", ...Array.from(new Set(projects.map((p) => p.emotion).filter(Boolean)))],
  }), [projects]);
  const facets = (["emotion", "category"] as const).filter((k) => options[k].length > 1);

  const list = useMemo(
    () => projects.filter((p) => (filters.category === "All" || p.category === filters.category) && (filters.emotion === "All" || p.emotion === filters.emotion)),
    [projects, filters],
  );

  useEffect(() => {
    const canvas = canvasRef.current, host = hostRef.current;
    if (!canvas || !host || list.length === 0) return;
    let api: SceneApi, last = -1;
    try {
      api = createWorkScene({
        canvas, host, projects: list, quality: qualityRef.current,
        reduceMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
        onActive: (i, accent) => {
          if (i !== last) { if (last >= 0) audioRef.current?.tick(); last = i; }
          setActive(i); host.style.setProperty("--accent", accent);
        },
        onOpen: (i) => router.push(`/projects/${list[i].slug}`),
        onReady: () => setReady(true),
      });
    } catch (err) { console.error("[work] WebGL scene failed:", err); queueMicrotask(() => setFailed(true)); return; }
    apiRef.current = api;
    return () => { api.dispose(); apiRef.current = null; };
  }, [list, router]);

  useEffect(() => { apiRef.current?.setQuality(quality); }, [quality]);
  useEffect(() => () => { audioRef.current?.dispose(); audioRef.current = null; }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight" || e.key === "ArrowDown") apiRef.current?.step(1);
      else if (e.key === "ArrowLeft" || e.key === "ArrowUp") apiRef.current?.step(-1);
      else if (e.key === "Enter" && !(e.target instanceof HTMLButtonElement || e.target instanceof HTMLAnchorElement)) apiRef.current?.open();
      else if (e.key === "Escape") { setMenu(false); setFacet(null); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const toggleSound = (v: boolean) => {
    if (v) { audioRef.current ??= createAudio(); audioRef.current.enable(); } else audioRef.current?.disable();
    setSound(v);
  };
  const levels = useCallback((n: number) => audioRef.current?.levels(n) ?? [], []);

  const cur = list[Math.min(active, list.length - 1)];
  const pick = (k: Facet, v: string) => {
    setFilters({ ...ALL, [k]: v }); setActive(0); setMenu(false); setFacet(null); setReady(false);
  };
  const label = filters.category !== "All" ? filters.category : filters.emotion !== "All" ? filters.emotion : null;

  return (
    <div ref={hostRef} className={`${s.root} ${dark ? "" : s.light}`}>
      {!failed && <canvas ref={canvasRef} className={s.canvas} aria-hidden="true" />}
      <div className={s.vignette} /><div className={s.grain} />

      <header className={s.header}>
        <Link href="/" className={s.brand}>Pouyan</Link>
        <nav className={s.nav} aria-label="Main">
          <Link href="/#about">About</Link>
          <Link href="/work" aria-current="page">Work</Link>
          <Link href="/#contact">Contact</Link>
        </nav>
        <div className={s.tools}>
          <SettingsMenu sound={sound} onSound={toggleSound} dark={dark} onDark={setDark} quality={quality} onQuality={setQuality} />
          <Equalizer on={sound} levels={levels} />
        </div>
        <Link href="/#contact" className={s.talk}>Let&rsquo;s talk <span aria-hidden>↳</span></Link>
      </header>

      {/* real links stay in the DOM for screen readers, crawlers and no-WebGL fallback */}
      <ul className={failed ? s.fallback : s.sr}>
        {list.map((p) => (<li key={p.slug}><Link href={`/projects/${p.slug}`}>{p.title}<span>{p.category}</span></Link></li>))}
      </ul>

      {!failed && cur && (
        <div className={`${s.ui} ${ready ? s.on : ""}`}>
          <div key={cur.slug} className={s.caption}>
            <h1 className={s.title}><span className={s.arrow} aria-hidden>↳</span><Scramble text={cur.title} duration={700} /></h1>
            <p className={s.meta}><Scramble text={cur.description.split(/[.\n]/)[0]} duration={1100} delay={250} /></p>
          </div>
          <Link href={`/projects/${cur.slug}`} className={s.open}>{cur.category}{cur.status ? ` · ${cur.status}` : ""} <b aria-hidden>→</b></Link>

          <div className={s.dock}>
            <div className={s.fwrap}>
              {menu && (
                <div className={s.fmenu} role="menu" onMouseLeave={() => setFacet(null)}>
                  {facets.map((k) => (
                    <button key={k} role="menuitem" aria-haspopup="menu" aria-expanded={facet === k} className={facet === k ? s.frowOn : s.frow}
                      onMouseEnter={() => setFacet(k)} onClick={() => setFacet(facet === k ? null : k)}>
                      <FacetIcon k={k} />{k === "emotion" ? "Emotion" : "Category"}<b aria-hidden>›</b>
                    </button>
                  ))}
                  {facet && (
                    <div className={s.fsub} role="menu">
                      {options[facet].map((v) => (
                        <button key={v} role="menuitemradio" aria-checked={filters[facet] === v} className={filters[facet] === v ? s.fitemOn : s.fitem} onClick={() => pick(facet, v)}>
                          <FacetIcon k={facet} />{v}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
              <button className={s.filter} aria-expanded={menu} aria-haspopup="menu" onClick={() => { setMenu((v) => !v); setFacet(null); }}>
                {label ?? "Filter"}
                <svg width="20" height="14" viewBox="0 0 20 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden>
                  <path d="M1 1.5h18M4 7h12M7.5 12.5h5" />
                </svg>
              </button>
            </div>
            <div className={s.counter}>
              <span>{pad(active + 1)}</span>
              <div className={s.ticks}>
                {list.map((p, i) => (<button key={p.slug} aria-label={p.title} aria-current={i === active} className={i === active ? s.tickOn : s.tick} onClick={() => apiRef.current?.goTo(i)} />))}
              </div>
              <span>{pad(list.length)}</span>
            </div>
          </div>

          <div className={s.orb} aria-hidden />
        </div>
      )}
    </div>
  );
}