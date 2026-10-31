import { Redis } from "@upstash/redis";
import { supabase } from "./supabase";

export type Project = {
  slug: string; title: string; category: string; status: string;
  description: string; tech: string[]; image_url: string | null;
  emotion: string; // optional column: "Calm", "Bold", ... ("" when the row has none)
};

const redis = Redis.fromEnv();
const KEY = "projects:v3"; // bumped: the shape changed (emotion), so the old cache is ignored
const TTL = 3600;

const normalize = (r: Partial<Project>): Project => ({
  slug: String(r.slug ?? ""),
  title: r.title ?? "Untitled",
  category: r.category ?? "Other",
  status: r.status ?? "",
  description: r.description ?? "",
  tech: Array.isArray(r.tech) ? r.tech : [],
  image_url: r.image_url ?? null,
  emotion: r.emotion ?? "",
});

export async function getProjects(): Promise<Project[]> {
  try {
    const cached = await redis.get<Project[]>(KEY);
    if (cached && cached.length > 0) return cached;
  } catch (e) {
    console.error("[projects] redis read failed:", e);
  }

  const { data, error } = await supabase
    .from("projects")
    .select("slug,title,category,status,description,tech,image_url,emotion")
    .eq("published", true)
    .order("sort_order", { ascending: true });

  if (error) {
    console.error("[projects] supabase error:", error.message);
    throw error;
  }

  const projects = (data ?? []).filter((r) => r.slug).map(normalize);
  if (projects.length === 0) {
    console.warn("[projects] 0 rows: check published=true rows and RLS SELECT policy for anon");
    return projects;
  }

  try {
    await redis.set(KEY, projects, { ex: TTL });
  } catch (e) {
    console.error("[projects] redis write failed:", e);
  }
  return projects;
}

export const invalidateProjects = () => redis.del(KEY);