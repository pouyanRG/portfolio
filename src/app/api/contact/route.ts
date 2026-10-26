import { NextResponse } from "next/server";
import { z } from "zod";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { supabaseAdmin } from "@/lib/supabase";

const ratelimit = new Ratelimit({
  redis: Redis.fromEnv(),
  limiter: Ratelimit.slidingWindow(3, "10 m"),
});

const schema = z.object({
  name: z.string().trim().min(2).max(100),
  email: z.string().email().optional().or(z.literal("")),
  phone: z.string().regex(/^[0-9+ -]{10,20}$/),
  message: z.string().trim().min(75).max(3000),
});

export async function POST(req: Request) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0] ?? "anon";
  const { success } = await ratelimit.limit(ip);
  if (!success)
    return NextResponse.json({ error: "تعداد درخواست‌ها زیاد است" }, { status: 429 });

  const parsed = schema.safeParse(await req.json());
  if (!parsed.success)
    return NextResponse.json({ error: "داده نامعتبر" }, { status: 400 });

  const { error } = await supabaseAdmin().from("messages").insert({
    ...parsed.data,
    email: parsed.data.email || null,
  });
  if (error)
    return NextResponse.json({ error: "خطای سرور" }, { status: 500 });

  return NextResponse.json({ ok: true });
}