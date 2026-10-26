import { Redis } from "@upstash/redis";
import { supabase } from "./supabase";

export type Project = {
  slug: string; title: string; category: string; status: string;
  description: string; tech: string[]; image_url: string | null;
};

const redis = Redis.fromEnv();
const KEY = "projects:v1";

export async function getProjects(): Promise<Project[]> {
  const cached = await redis.get<Project[]>(KEY);
  if (cached) return cached;

  const { data, error } = await supabase
    .from("projects").select("*")
    .eq("published", true).order("sort_order");
  if (error) throw error;

  await redis.set(KEY, data, { ex: 3600 }); // یک ساعت
  return data as Project[];
}