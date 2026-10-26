import Link from "next/link";
import type { Project } from "@/lib/projects";

type ProjectCardProps = {
  project: Project;
};

export default function ProjectCard({ project }: ProjectCardProps) {
  return (
    <article className="group overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03] transition duration-300 hover:-translate-y-1 hover:border-indigo-400/40">
      {project.image_url ? (
        <div className="aspect-video overflow-hidden bg-white/5">
          <img
            src={project.image_url}
            alt={project.title}
            className="h-full w-full object-cover transition duration-500 group-hover:scale-105"
          />
        </div>
      ) : null}

      <div className="p-6">
        <div className="mb-3 flex items-center justify-between gap-3">
          <span className="text-sm text-indigo-300">
            {project.category}
          </span>
          <span className="rounded-full border border-white/10 px-3 py-1 text-xs text-white/60">
            {project.status}
          </span>
        </div>

        <h2 className="text-2xl font-bold text-white">
          {project.title}
        </h2>

        <p className="mt-3 leading-7 text-white/65">
          {project.description}
        </p>

        {project.tech.length > 0 && (
          <div className="mt-5 flex flex-wrap gap-2">
            {project.tech.map((item) => (
              <span
                key={item}
                className="rounded-lg bg-white/5 px-3 py-1.5 text-xs text-white/70"
              >
                {item}
              </span>
            ))}
          </div>
        )}

        <Link
          href={`/projects/${project.slug}`}
          className="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-indigo-300 transition hover:text-indigo-200"
        >
          View Project <span aria-hidden="true">→</span>
        </Link>
      </div>
    </article>
  );
}
