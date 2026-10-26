export const instant = false;
import { getProjects } from "@/lib/projects";
import ProjectCard from "@/components/ProjectCard";

export const metadata = { title: "Pouyan | Projects" };

export default async function ProjectsPage() {
  const projects = await getProjects();
  return (
    <main className="mx-auto mt-24 max-w-[1200px] px-5">
      <h1 className="text-center text-5xl font-extrabold">My Projects</h1>
      <div className="mt-14 grid grid-cols-[repeat(auto-fit,minmax(360px,1fr))] gap-9">
        {projects.map((p) => <ProjectCard key={p.slug} project={p} />)}
      </div>
    </main>
  );
}
