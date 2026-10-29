"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Project } from "@/lib/projects";
import { createWorkScene, type SceneApi } from "./scene";
import s from "./WorkGallery.module.css";

const pad = (n: number) => String(n).padStart(2, "0");

export default function WorkGallery({ projects }: { projects: Project[] }) {
  const router = useRouter();
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const apiRef = useRef<SceneApi | null>(null);
  const [filter, setFilter] = useState("All");
  const [menu, setMenu] = useState(false);
  const [active, setActive] = useState(0);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  const categories = useMemo(() => ["All", ...Array.from(new Set(projects.map((p) => p.category)))], [projects]);
  const list = useMemo(() => (filter === "All" ? projects : projects.filter((p) => p.category === filter)), [projects, filter]);

  useEffect(() => {
    const canvas = canvasRef.current, host = hostRef.current;
    if (!canvas || !host || list.length === 0) return;
    let api: SceneApi;
    try {
      api = createWorkScene({
        canvas, host, projects: list,
        reduceMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
        onActive: (i, accent) => { setActive(i); host.style.setProperty("--accent", accent); },
        onOpen: (i) => router.push(`/projects/${list[i].slug}`),
        onReady: () => setReady(true),
      });
    } catch { queueMicrotask(() => setFailed(true)); return; }
    apiRef.current = api;
    return () => { api.dispose(); apiRef.current = null; };
  }, [list, router]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight" || e.key === "ArrowDown") apiRef.current?.step(1);
      else if (e.key === "ArrowLeft" || e.key === "ArrowUp") apiRef.current?.step(-1);
      else if (e.key === "Enter" && !(e.target instanceof HTMLButtonElement || e.target instanceof HTMLAnchorElement)) apiRef.current?.open();
      else if (e.key === "Escape") setMenu(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const cur = list[Math.min(active, list.length - 1)];
  const pick = (c: string) => { setFilter(c); setActive(0); setMenu(false); setReady(false); };

  return (
    <div ref={hostRef} className={s.root}>
      {!failed && <canvas ref={canvasRef} className={s.canvas} aria-hidden="true" />}
      <div className={s.vignette} /><div className={s.grain} />
      <Link href="/" className={s.brand}>Pouyan</Link>

      {/* real links stay in the DOM for screen readers, crawlers and no-WebGL fallback */}
      <ul className={failed ? s.fallback : s.sr}>
        {list.map((p) => (<li key={p.slug}><Link href={`/projects/${p.slug}`}>{p.title}<span>{p.category}</span></Link></li>))}
      </ul>

      {!failed && cur && (
        <div className={`${s.ui} ${ready ? s.on : ""}`}>
          <div key={cur.slug} className={s.caption}>
            <h1 className={s.title}>{cur.title}<sup>™</sup></h1>
            <p className={s.meta}>{cur.description.split(/[.\n]/)[0]}</p>
          </div>
          <Link href={`/projects/${cur.slug}`} className={s.open}>{cur.category} · {cur.status} <b aria-hidden>→</b></Link>

          <div className={s.dock}>
            {menu && (
              <div className={s.menu} role="menu">
                {categories.map((c) => (<button key={c} role="menuitemradio" aria-checked={c === filter} className={c === filter ? s.chipOn : s.chip} onClick={() => pick(c)}>{c}</button>))}
              </div>
            )}
            <button className={s.filter} aria-expanded={menu} onClick={() => setMenu((v) => !v)}>Filter</button>
            <div className={s.counter}>
              <span>{pad(active + 1)}</span>
              <div className={s.ticks}>
                {list.map((p, i) => (<button key={p.slug} aria-label={p.title} aria-current={i === active} className={i === active ? s.tickOn : s.tick} onClick={() => apiRef.current?.goTo(i)} />))}
              </div>
              <span>{pad(list.length)}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}