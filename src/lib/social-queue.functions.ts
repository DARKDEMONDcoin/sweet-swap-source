/**
 * دوال الخادم لطابور النشر الاجتماعي: جدولة منشور، نشره فوراً، وإلغاؤه.
 * كل الدوال محمية بملكية مساحة العمل.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function assertOwner(
  supabase: {
    rpc: (
      fn: "owns_workspace",
      args: { _workspace_id: string },
    ) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
  },
  workspaceId: string,
) {
  const { data, error } = await supabase.rpc("owns_workspace", { _workspace_id: workspaceId });
  if (error) throw new Error(error.message);
  if (data !== true) throw new Error("Forbidden: لا تملك هذه مساحة العمل.");
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

const scheduleInput = z.object({
  workspaceId: z.string().uuid(),
  employeeId: z.string().min(1).max(40).default("sonny"),
  taskId: z.string().uuid().nullish(),
  provider: z.string().min(1).max(40),
  body: z.string().min(1).max(20_000),
  imageUrl: z.string().url().nullish(),
  scheduledAt: z.string().datetime(),
});

/** يضيف منشوراً إلى طابور النشر بموعد محدد. */
export const scheduleSocialPost = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => scheduleInput.parse(input))
  .handler(async ({ data, context }) => {
    const admin = await assertOwner(context.supabase, data.workspaceId);

    // لا نجدول على منصة غير مربوطة — نفشل مبكراً برسالة واضحة بدل فشل صامت وقت النشر.
    const { data: account } = await admin
      .from("pipedream_accounts")
      .select("id")
      .eq("workspace_id", data.workspaceId)
      .eq("provider", data.provider)
      .eq("status", "connected")
      .maybeSingle();
    if (!account) {
      throw new Error("هذه المنصة غير مربوطة بعد — اربطها من صفحة التكاملات ثم أعد الجدولة.");
    }

    const { data: row, error } = await admin
      .from("social_posts")
      .insert({
        workspace_id: data.workspaceId,
        employee_id: data.employeeId,
        task_id: data.taskId ?? null,
        provider: data.provider,
        body: data.body,
        image_url: data.imageUrl ?? null,
        scheduled_at: data.scheduledAt,
        status: "scheduled",
      })
      .select("id, scheduled_at")
      .single();
    if (error) throw new Error(error.message);
    return { ok: true as const, id: row.id, scheduledAt: row.scheduled_at };
  });

/** ينشر الآن: يضيف المنشور ثم ينفّذه فوراً بنفس نواة الطابور. */
export const publishSocialNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    scheduleInput.omit({ scheduledAt: true }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const admin = await assertOwner(context.supabase, data.workspaceId);
    const { data: row, error } = await admin
      .from("social_posts")
      .insert({
        workspace_id: data.workspaceId,
        employee_id: data.employeeId,
        task_id: data.taskId ?? null,
        provider: data.provider,
        body: data.body,
        image_url: data.imageUrl ?? null,
        scheduled_at: new Date().toISOString(),
        status: "scheduled",
        locked_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);

    const { publishQueuedPost } = await import("./social-queue.server");
    const result = await publishQueuedPost(admin, row.id);
    if (result.status !== "published") throw new Error(result.error ?? "تعذّر النشر.");
    return { ok: true as const, id: row.id };
  });

/** يعيد محاولة منشور فشل أو يلغي منشوراً مجدولاً. */
export const updateSocialPost = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        workspaceId: z.string().uuid(),
        id: z.string().uuid(),
        action: z.enum(["cancel", "retry", "reschedule"]),
        scheduledAt: z.string().datetime().nullish(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const admin = await assertOwner(context.supabase, data.workspaceId);

    if (data.action === "cancel") {
      const { error } = await admin
        .from("social_posts")
        .update({ status: "cancelled", locked_at: null })
        .eq("id", data.id)
        .eq("workspace_id", data.workspaceId)
        .neq("status", "published");
      if (error) throw new Error(error.message);
      return { ok: true as const };
    }

    if (data.action === "reschedule") {
      if (!data.scheduledAt) throw new Error("الموعد الجديد مطلوب.");
      const { error } = await admin
        .from("social_posts")
        .update({ scheduled_at: data.scheduledAt, status: "scheduled", locked_at: null })
        .eq("id", data.id)
        .eq("workspace_id", data.workspaceId)
        .neq("status", "published");
      if (error) throw new Error(error.message);
      return { ok: true as const };
    }

    await admin
      .from("social_posts")
      .update({ status: "scheduled", attempts: 0, locked_at: new Date().toISOString(), last_error: null })
      .eq("id", data.id)
      .eq("workspace_id", data.workspaceId)
      .neq("status", "published");

    const { publishQueuedPost } = await import("./social-queue.server");
    const result = await publishQueuedPost(admin, data.id);
    if (result.status !== "published") throw new Error(result.error ?? "تعذّر النشر.");
    return { ok: true as const };
  });
