import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * تتبّع ترتيب الكلمات المفتاحية عبر الزمن — لوحة تاريخية حقيقية:
 * نلتقط ترتيب نطاقك في نتائج البحث الحية لكل كلمة متتبَّعة ونخزّن لقطة بتاريخها،
 * فترى الاتجاه (تحسّن/تراجع) بأرقام فعلية لا تقديرات.
 */

const ws = { workspaceId: z.string().uuid() };

const cleanDomain = (value: string) =>
  value
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "")
    .replace(/\/.*$/, "")
    .toLowerCase();

export const listTrackedKeywords = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object(ws).parse(input))
  .handler(async ({ data, context }) => {
    const [{ data: keywords, error }, { data: snapshots }] = await Promise.all([
      context.supabase
        .from("tracked_keywords")
        .select("*")
        .eq("workspace_id", data.workspaceId)
        .order("created_at", { ascending: true }),
      context.supabase
        .from("rank_snapshots")
        .select("keyword_id, position, url, captured_at")
        .eq("workspace_id", data.workspaceId)
        .order("captured_at", { ascending: true })
        .limit(1000),
    ]);
    if (error) throw new Error(error.message);

    const history: Record<
      string,
      { position: number | null; url: string | null; capturedAt: string }[]
    > = {};
    for (const snap of snapshots ?? []) {
      (history[snap.keyword_id] ??= []).push({
        position: snap.position,
        url: snap.url,
        capturedAt: snap.captured_at,
      });
    }
    return { keywords: keywords ?? [], history };
  });

export const addTrackedKeyword = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        ...ws,
        keyword: z.string().min(2).max(120),
        domain: z.string().min(3).max(160),
        market: z.string().min(2).max(8).default("SA"),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("tracked_keywords").insert({
      workspace_id: data.workspaceId,
      keyword: data.keyword.trim(),
      domain: cleanDomain(data.domain),
      market: data.market,
    });
    if (error && !error.message.includes("duplicate")) throw new Error(error.message);
    return { ok: true as const };
  });

export const removeTrackedKeyword = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ ...ws, id: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("tracked_keywords")
      .delete()
      .eq("id", data.id)
      .eq("workspace_id", data.workspaceId);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

/** يفحص كل الكلمات المفعّلة الآن ويخزّن لقطة ترتيب جديدة لكل واحدة. */
export const refreshRankings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object(ws).parse(input))
  .handler(async ({ data, context }) => {
    const { data: keywords, error } = await context.supabase
      .from("tracked_keywords")
      .select("id, keyword, domain")
      .eq("workspace_id", data.workspaceId)
      .eq("active", true)
      .limit(50);
    if (error) throw new Error(error.message);
    if (!keywords?.length) return { checked: 0 };

    const { serpSearch } = await import("./seo-research.server");
    const now = new Date().toISOString();
    let checked = 0;

    for (const row of keywords) {
      try {
        const results = await serpSearch(row.keyword);
        const hit = results.find((r) => {
          try {
            const host = new URL(r.url).hostname.replace(/^www\./, "").toLowerCase();
            return host === row.domain || host.endsWith(`.${row.domain}`);
          } catch {
            return false;
          }
        });
        await context.supabase.from("rank_snapshots").insert({
          workspace_id: data.workspaceId,
          keyword_id: row.id,
          position: hit?.rank ?? null,
          url: hit?.url ?? null,
          captured_at: now,
        });
        await context.supabase
          .from("tracked_keywords")
          .update({ last_checked_at: now })
          .eq("id", row.id);
        checked += 1;
      } catch (e) {
        console.error("[nour] rank check failed:", e);
      }
    }
    return { checked };
  });
