"use client";
import dynamic from "next/dynamic";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Project } from "@/lib/projects";

const WorkScene = dynamic(() => import("./WorkScene"), { ssr: false });

export default function WorkGallery({ projects }: { projects: Project[] }) {
  const router = useRouter();
  const [active, setActive] = useState(0);
  const total = projects.length;

  if (total === 0) return <main className="p-10 text-white">No projects yet.</main>;
  const p = projects[active] ?? projects[0];

  return (
    <main className="fixed inset-0 overflow-hidden bg-[#030108] text-white">
      <WorkScene
        projects={projects}
        onActive={setActive}
        onSelect={(slug) => router.push(`/projects/${slug}`)}
      />

      <div className="pointer-events-none absolute bottom-10 left-8 max-w-[60vw]">
        <h1 className="text-5xl leading-none md:text-7xl" style={{ fontFamily: "var(--font-serif)" }}>
          <span className="mr-2 text-2xl align-top">↳</span>{p.title}
        </h1>
        <p className="mt-4 text-[11px] uppercase tracking-wide" style={{ fontFamily: "var(--font-plex-mono)" }}>
          {p.description.slice(0, 80)}
        </p>
      </div>

      <div
        className="pointer-events-none absolute bottom-10 left-1/2 flex -translate-x-1/2 items-center gap-4 text-xs"
        style={{ fontFamily: "var(--font-plex-mono)" }}
      >
        <span>{String(active + 1).padStart(2, "0")}</span>
        <div className="flex h-4 items-center gap-[7px]">
          {projects.map((_, i) => (
            <span
              key={i}
              className={`block w-px bg-white/50 transition-all ${i === active ? "h-4 w-2 rounded-sm border border-white bg-transparent" : "h-3"}`}
            />
          ))}
        </div>
        <span>{String(total).padStart(2, "0")}</span>
      </div>
    </main>
  );
}