import { Suspense } from "react";
import { Instrument_Serif } from "next/font/google";
import { getProjects } from "@/lib/projects";
import WorkGallery from "@/components/work/WorkGallery";

export const metadata = { title: "Pouyan | Work" };
const serif = Instrument_Serif({ weight: "400", subsets: ["latin"], variable: "--font-serif" });

async function Gallery() {
  const projects = await getProjects();
  if (projects.length === 0) return <p style={{ position: "fixed", inset: 0, display: "grid", placeItems: "center", background: "#030206", color: "#fff" }}>No projects yet.</p>;
  return <WorkGallery projects={projects} />;
}

export default function WorkPage() {
  return (
    <div className={serif.variable}>
      <Suspense fallback={<div style={{ position: "fixed", inset: 0, background: "#030206" }} />}>
        <Gallery />
      </Suspense>
    </div>
  );
}