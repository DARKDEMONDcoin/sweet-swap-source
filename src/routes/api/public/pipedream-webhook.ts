/**
 * مستقبل أحداث Pipedream Connect (نجاح الربط / فشله / حذف الحساب).
 * الحماية: مفتاح سري في مسار الاستدعاء (?token=) يُطابق PIPEDREAM_WEBHOOK_SECRET في app_secrets.
 */
import { createFileRoute } from "@tanstack/react-router";

import { pipedreamApps } from "@/data/pipedream-apps";

type Event = {
  event?: string;
  event_type?: string;
  account?: {
    id?: string;
    name?: string | null;
    healthy?: boolean;
    external_id?: string;
    app?: { name_slug?: string } | string;
  };
  external_user_id?: string;
  error?: string;
};

export const Route = createFileRoute("/api/public/pipedream-webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const token = new URL(request.url).searchParams.get("token") ?? "";
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        const { data: secret } = await supabaseAdmin
          .from("app_secrets")
          .select("value")
          .eq("name", "PIPEDREAM_WEBHOOK_SECRET")
          .maybeSingle();
        const expected = secret?.value ?? process.env["PIPEDREAM_WEBHOOK_SECRET"] ?? "";
        if (!expected || token !== expected) return new Response("Unauthorized", { status: 401 });

        const payload = (await request.json()) as Event;
        const externalUserId = payload.external_user_id ?? payload.account?.external_id ?? "";
        const workspaceId = externalUserId.startsWith("ws_") ? externalUserId.slice(3) : "";
        const accountId = payload.account?.id ?? "";
        const slug =
          typeof payload.account?.app === "string"
            ? payload.account.app
            : (payload.account?.app?.name_slug ?? "");
        const provider = pipedreamApps.find((a) => a.slug === slug)?.provider;

        if (!workspaceId || !accountId || !provider) return new Response("ok");

        const kind = (payload.event ?? payload.event_type ?? "").toUpperCase();

        if (kind.includes("DELET") || kind.includes("DISCONNECT")) {
          await supabaseAdmin
            .from("pipedream_accounts")
            .delete()
            .eq("workspace_id", workspaceId)
            .eq("account_id", accountId);
          await supabaseAdmin
            .from("integrations")
            .update({ status: "disconnected", account: null })
            .eq("workspace_id", workspaceId)
            .eq("provider", provider);
          return new Response("ok");
        }

        const healthy = payload.account?.healthy !== false && !kind.includes("ERROR");
        await supabaseAdmin.from("pipedream_accounts").upsert(
          {
            workspace_id: workspaceId,
            provider,
            app_slug: slug,
            account_id: accountId,
            account_name: payload.account?.name ?? null,
            status: healthy ? "connected" : "error",
            healthy,
            last_error: payload.error ?? null,
          },
          { onConflict: "workspace_id,provider,account_id" },
        );
        await supabaseAdmin
          .from("integrations")
          .update({
            status: healthy ? "connected" : "error",
            account: payload.account?.name ?? slug,
          })
          .eq("workspace_id", workspaceId)
          .eq("provider", provider);

        return new Response("ok");
      },
    },
  },
});
