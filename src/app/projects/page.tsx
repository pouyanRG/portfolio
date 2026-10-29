export const instant = false;
import { getProjects } from "@/lib/projects";
import WorkGallery from "@/components/work/WorkGallery";

export const metadata = { title: "Pouyan | Projects" };

export default async function ProjectsPage() {
  const projects = await getProjects();
  return <WorkGallery projects={projects} />;
}