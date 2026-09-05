/**
 * دوال الخادم لربط الحسابات عبر Pipedream Connect.
 * لا تُخزَّن أي بيانات اعتماد لدينا — فقط معرّف الحساب لدى Pipedream.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { pipedreamApp } from "@/data/pipedream-apps";

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

/** هل ضُبطت مفاتيح Pipedream؟ تُستخدم لعرض الحالة في الواجهة. */
export const pipedreamStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const { pipedreamConfig } = await import("./pipedream.server");
    const config = await pipedreamConfig();
    return { ready: Boolean(config), environment: config?.environment ?? null };
  });

/** يبدأ ربط منصة: يعيد رابط Pipedream الجاهز لفتحه في نافذة الربط. */
export const startPipedreamConnect = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        workspaceId: z.string().uuid(),
        provider: z.string().min(1).max(40),
        origin: z.string().url(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    // مساحة التجربة مشتركة بين الزوار — يُمنع ربط حسابات حقيقية بها.
    if (typeof context.claims?.email === "string" && context.claims.email === "guest@sahl.app") {
      throw new Error(
        "أنت في وضع التجربة — سجّل دخولك بحسابك ثم اربط منصاتك ليُحفظ الربط في مساحتك.",
      );
    }
    await assertOwner(context.supabase, data.workspaceId);
    const app = pipedreamApp(data.provider);
    if (!app) throw new Error("هذه المنصة لا تُدار عبر Pipedream.");

    const { pipedreamConfig, createConnectToken, missingConfigError } = await import(
      "./pipedream.server"
    );
    const config = await pipedreamConfig();
    if (!config) throw missingConfigError();

    const origin = new URL(data.origin).origin;
    const token = await createConnectToken(config, data.workspaceId, [origin]);

    const base =
      token.connect_link_url ??
      `https://pipedream.com/_static/connect.html?token=${encodeURIComponent(token.token)}`;
    const url = new URL(base);
    url.searchParams.set("app", app.slug);
    url.searchParams.set("success_redirect_uri", `${origin}/app/integrations?pd=connected`);
    url.searchParams.set("error_redirect_uri", `${origin}/app/integrations?pd=failed`);

    return { url: url.toString(), app: app.slug, label: app.label };
  });

/** يزامن الحسابات المربوطة من Pipedream إلى قاعدتنا ويحدّث حالة التكاملات. */
export const syncPipedreamAccounts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ workspaceId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const admin = await assertOwner(context.supabase, data.workspaceId);
    const { pipedreamConfig, listAccounts, missingConfigError } = await import("./pipedream.server");
    const { pipedreamApps } = await import("@/data/pipedream-apps");
    const config = await pipedreamConfig();
    if (!config) throw missingConfigError();

    const accounts = await listAccounts(config, data.workspaceId);
    const slugToProvider = new Map(pipedreamApps.map((a) => [a.slug, a.provider]));

    const seen: string[] = [];
    for (const account of accounts) {
      const slug =
        typeof account.app === "string" ? account.app : (account.app?.name_slug ?? "");
      const provider = slugToProvider.get(slug);
      if (!provider) continue;
      seen.push(provider);
      await admin.from("pipedream_accounts").upsert(
        {
          workspace_id: data.workspaceId,
          provider,
          app_slug: slug,
          account_id: account.id,
          account_name: account.name ?? null,
          status: account.healthy === false ? "error" : "connected",
          healthy: account.healthy !== false,
        },
        { onConflict: "workspace_id,provider,account_id" },
      );
      await admin
        .from("integrations")
        .update({
          status: account.healthy === false ? "error" : "connected",
          account: account.name ?? slug,
        })
        .eq("workspace_id", data.workspaceId)
        .eq("provider", provider);
    }

    // أي منصة كانت مربوطة عبر Pipedream ولم تعد موجودة → نُرجعها إلى «غير مربوطة».
    const { data: stored } = await admin
      .from("pipedream_accounts")
      .select("id, provider, account_id")
      .eq("workspace_id", data.workspaceId);
    const liveIds = new Set(accounts.map((a) => a.id));
    for (const row of stored ?? []) {
      if (liveIds.has(row.account_id)) continue;
      await admin.from("pipedream_accounts").delete().eq("id", row.id);
      await admin
        .from("integrations")
        .update({ status: "disconnected", account: null })
        .eq("workspace_id", data.workspaceId)
        .eq("provider", row.provider);
    }

    return { ok: true as const, connected: seen };
  });

/** فصل منصة مربوطة عبر Pipedream (يُلغى الحساب لدى Pipedream أيضاً). */
export const disconnectPipedream = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ workspaceId: z.string().uuid(), provider: z.string().min(1).max(40) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const admin = await assertOwner(context.supabase, data.workspaceId);
    const { pipedreamConfig, deleteAccount } = await import("./pipedream.server");
    const config = await pipedreamConfig();

    const { data: rows } = await admin
      .from("pipedream_accounts")
      .select("account_id")
      .eq("workspace_id", data.workspaceId)
      .eq("provider", data.provider);

    if (config) {
      for (const row of rows ?? []) {
        try {
          await deleteAccount(config, row.account_id);
        } catch (error) {
          console.error("[pipedream] delete account failed", error);
        }
      }
    }

    await admin
      .from("pipedream_accounts")
      .delete()
      .eq("workspace_id", data.workspaceId)
      .eq("provider", data.provider);
    await admin
      .from("integrations")
      .update({ status: "disconnected", account: null })
      .eq("workspace_id", data.workspaceId)
      .eq("provider", data.provider);

    return { ok: true as const };
  });

/** نشر نص/صورة على منصة مربوطة عبر إجراء Pipedream الجاهز. */
export const publishViaPipedream = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        workspaceId: z.string().uuid(),
        provider: z.string().min(1).max(40),
        text: z.string().min(1).max(20_000),
        imageUrl: z.string().url().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const admin = await assertOwner(context.supabase, data.workspaceId);
    const { publishToPlatform } = await import("./pipedream-publish.server");
    const published = await publishToPlatform(admin, {
      workspaceId: data.workspaceId,
      provider: data.provider,
      text: data.text,
      ...(data.imageUrl ? { imageUrl: data.imageUrl } : {}),
    });
    return {
      ok: true as const,
      provider: published.provider,
      accountId: published.accountId,
      result: JSON.stringify(published.result ?? null).slice(0, 4000),
    };
  });
