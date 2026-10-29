import { Redis } from "@upstash/redis";
import { supabase } from "./supabase";

export type Project = {
  slug: string; title: string; category: string; status: string;
  description: string; tech: string[]; image_url: string | null;
};

const redis = Redis.fromEnv();
const KEY = "projects:v2"; // نسخه جدید = کش خالی قبلی (v1) دور ریخته می‌شود
const TTL = 3600; // یک ساعت

// ردیف‌های ناقص دیتابیس نباید صفحه را بشکنند
const normalize = (r: Partial<Project>): Project => ({
  slug: String(r.slug ?? ""),
  title: r.title ?? "Untitled",
  category: r.category ?? "Other",
  status: r.status ?? "",
  description: r.description ?? "",
  tech: Array.isArray(r.tech) ? r.tech : [],
  image_url: r.image_url ?? null,
});

export async function getProjects(): Promise<Project[]> {
  // اگر Redis قطع بود، سایت باید با Supabase کار کند
  try {
    const cached = await redis.get<Project[]>(KEY);
    if (cached && cached.length > 0) return cached;
  } catch (e) {
    console.error("[projects] redis read failed:", e);
  }

  const { data, error } = await supabase
    .from("projects")
    .select("slug,title,category,status,description,tech,image_url")
    .eq("published", true)
    .order("sort_order", { ascending: true });

  if (error) {
    console.error("[projects] supabase error:", error.message);
    throw error;
  }

  const projects = (data ?? []).filter((r) => r.slug).map(normalize);
  if (projects.length === 0) {
    console.warn("[projects] 0 rows: check published=true rows and RLS SELECT policy for anon");
    return projects; // نتیجه خالی هرگز کش نمی‌شود
  }

  try {
    await redis.set(KEY, projects, { ex: TTL });
  } catch (e) {
    console.error("[projects] redis write failed:", e);
  }
  return projects;
}

// بعد از ویرایش پروژه در پنل ادمین صدا بزن تا کش فوراً تازه شود
export const invalidateProjects = () => redis.del(KEY);