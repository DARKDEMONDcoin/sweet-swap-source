import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ShieldCheck, RefreshCw, Loader2, Plug } from "lucide-react";

import { AppShell } from "@/components/app/AppShell";
import { AppIcon, appLabel } from "@/components/site/AppIcon";
import { WordPressConnect } from "@/components/app/WordPressConnect";
import { SearchConsoleSites } from "@/components/app/SearchConsoleSites";
import { IndexNowSetup } from "@/components/app/IndexNowSetup";
import { Ga4Properties } from "@/components/app/Ga4Properties";
import { ShopifyConnect } from "@/components/app/ShopifyConnect";
import { WebflowConnect } from "@/components/app/WebflowConnect";
import { GhostConnect } from "@/components/app/GhostConnect";
import { team } from "@/data/team";
import { integrationStatusLabel } from "@/data/app";
import { isPipedreamProvider, pipedreamApp } from "@/data/pipedream-apps";
import { useIntegrations, useSetIntegrationStatus, useWorkspace } from "@/lib/data";
import { disconnectProvider } from "@/lib/integrations.functions";
import {
  disconnectPipedream,
  pipedreamStatus,
  startPipedreamConnect,
  syncPipedreamAccounts,
} from "@/lib/pipedream.functions";
import { GUEST_EMAIL } from "@/lib/guest.functions";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/app/integrations")({
  head: () => ({
    meta: [
      { title: "التكاملات | سهل" },
      { name: "description", content: "اربط حسابات علامتك ليعمل فريقك مباشرة عليها." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: IntegrationsPage,
});

/** المنصات المربوطة ربطاً مباشراً من داخل المنصة (بدون وسيط). */
const realProviders = new Set([
  "wordpress",
  "indexnow",
  "shopify",
  "webflow",
  "ghost",
]);

const gscMessages: Record<string, string> = {
  denied: "أُلغيت موافقة Google — لم يتم الربط.",
  token_failed: "تعذّر إكمال الربط مع Google، جرّب مرة أخرى.",
  no_refresh_token: "لم يمنحنا Google صلاحية دائمة — أعد المحاولة واقبل الصلاحيات.",
  store_failed: "تعذّر حفظ بيانات الربط.",
  failed: "تعذّر إكمال الربط.",
};

function IntegrationsPage() {
  const qc = useQueryClient();
  const { data: workspace } = useWorkspace();
  const { data: integrations, isLoading } = useIntegrations(workspace?.id);
  const setStatus = useSetIntegrationStatus(workspace?.id);
  const disconnect = useServerFn(disconnectProvider);
  const startConnect = useServerFn(startPipedreamConnect);
  const syncAccounts = useServerFn(syncPipedreamAccounts);
  const disconnectPd = useServerFn(disconnectPipedream);
  const checkPipedream = useServerFn(pipedreamStatus);
  const [isGuest, setIsGuest] = useState(false);
  const [pdReady, setPdReady] = useState<boolean | null>(null);
  const [pdEnv, setPdEnv] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [wpOpen, setWpOpen] = useState(false);
  const [gscOpen, setGscOpen] = useState(false);
  const [indexNowOpen, setIndexNowOpen] = useState(false);
  const [ga4Open, setGa4Open] = useState(false);
  const [shopifyOpen, setShopifyOpen] = useState(false);
  const [webflowOpen, setWebflowOpen] = useState(false);
  const [ghostOpen, setGhostOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingSync, setPendingSync] = useState(false);

  useEffect(() => {
    void supabase.auth
      .getUser()
      .then(({ data }) => setIsGuest(data.user?.email === GUEST_EMAIL))
      .catch(() => setIsGuest(false));
  }, []);

  useEffect(() => {
    void checkPipedream({ data: undefined })
      .then((r) => {
        setPdReady(r.ready);
        setPdEnv(r.environment ?? null);
      })
      .catch(() => setPdReady(false));
  }, [checkPipedream]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const status = params.get("gsc");
    const pd = params.get("pd");
    if (!status && !pd) return;
    if (status === "connected") setGscOpen(true);
    else if (status) setError(gscMessages[status] ?? "تعذّر إكمال ربط Search Console.");
    if (pd === "failed") setError("لم يكتمل الربط عبر Pipedream — جرّب مرة أخرى.");
    if (pd === "connected") setPendingSync(true);
    window.history.replaceState({}, "", window.location.pathname);
    // نقرأ علامات العودة مرة واحدة فقط. لا نعتمد على جاهزية مساحة العمل هنا،
    // وإلا يُمسح `?pd=connected` قبل بدء المزامنة فيظهر الربط كأنه لم يحدث.
  }, []);

  useEffect(() => {
    if (!pendingSync || !workspace) return;
    setPendingSync(false);
    void syncAccounts({ data: { workspaceId: workspace.id } })
      .then(() => qc.invalidateQueries({ queryKey: ["integrations", workspace.id] }))
      .catch(() => setError("تم الربط لكن تعذّرت المزامنة — اضغط «تحديث الحسابات»."));
  }, [pendingSync, workspace, qc, syncAccounts]);

  const all = integrations ?? [];
  const connected = all.filter((i) => i.status === "connected").length;
  const broken = all.filter((i) => i.status === "error");

  const refresh = async () => {
    if (!workspace) return;
    setBusy("sync");
    setError(null);
    try {
      await syncAccounts({ data: { workspaceId: workspace.id } });
      void qc.invalidateQueries({ queryKey: ["integrations", workspace.id] });
    } catch (e) {
      setError(e instanceof Error ? e.message : "تعذّرت مزامنة الحسابات");
    } finally {
      setBusy(null);
    }
  };

  const toggle = async (id: string, status: string, provider: string) => {
    setError(null);
    if (isGuest) {
      setError(
        "أنت في وضع التجربة (بدون تسجيل) — مساحة التجربة مشتركة، فلا يمكن ربط حساباتك الحقيقية بها. سجّل دخولك بحسابك ثم اربط منصاتك.",
      );
      return;
    }
    if (realProviders.has(provider)) {
      if (status !== "connected") {
        if (provider === "wordpress") {
          setWpOpen(true);
          return;
        }
        if (provider === "indexnow") {
          setIndexNowOpen(true);
          return;
        }
        if (provider === "shopify") {
          setShopifyOpen(true);
          return;
        }
        if (provider === "webflow") {
          setWebflowOpen(true);
          return;
        }
        if (provider === "ghost") {
          setGhostOpen(true);
          return;
        }
        return;
      }
      setBusy(id);
      try {
        await disconnect({ data: { workspaceId: workspace!.id, provider } });
        void qc.invalidateQueries({ queryKey: ["integrations", workspace?.id] });
      } catch (e) {
        setError(e instanceof Error ? e.message : "تعذّر فصل الحساب");
      } finally {
        setBusy(null);
      }
      return;
    }

    if (isPipedreamProvider(provider) && workspace) {
      setBusy(id);
      try {
        if (status === "connected" && provider === "analytics") {
          setGa4Open(true);
        } else if (status === "connected" || status === "error") {
          await disconnectPd({ data: { workspaceId: workspace.id, provider } });
          void qc.invalidateQueries({ queryKey: ["integrations", workspace.id] });
        } else {
          const { url } = await startConnect({
            data: { workspaceId: workspace.id, provider, origin: window.location.origin },
          });
          window.location.href = url;
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "تعذّر بدء الربط عبر Pipedream");
      } finally {
        setBusy(null);
      }
      return;
    }

    setBusy(id);
    try {
      if (status === "connected") {
        await setStatus.mutateAsync({ id, status: "disconnected", account: null });
      } else {
        await setStatus.mutateAsync({
          id,
          status: "connected",
          account: `${workspace?.name ?? "حسابي"} · ${appLabel(provider)}`,
        });
      }
    } finally {
      setBusy(null);
    }
  };



  return (
    <AppShell
      title="التكاملات"
      lead={`${connected} حساباً مرتبطاً · حساب واحد لكل منصة داخل مساحة العمل`}
    >
      {wpOpen && workspace ? (
        <WordPressConnect workspaceId={workspace.id} onClose={() => setWpOpen(false)} />
      ) : null}

      {gscOpen && workspace ? (
        <SearchConsoleSites workspaceId={workspace.id} onClose={() => setGscOpen(false)} />
      ) : null}

      {indexNowOpen && workspace ? (
        <IndexNowSetup workspaceId={workspace.id} onClose={() => setIndexNowOpen(false)} />
      ) : null}

      {ga4Open && workspace ? (
        <Ga4Properties workspaceId={workspace.id} onClose={() => setGa4Open(false)} />
      ) : null}

      {shopifyOpen && workspace ? (
        <ShopifyConnect workspaceId={workspace.id} onClose={() => setShopifyOpen(false)} />
      ) : null}

      {webflowOpen && workspace ? (
        <WebflowConnect workspaceId={workspace.id} onClose={() => setWebflowOpen(false)} />
      ) : null}

      {ghostOpen && workspace ? (
        <GhostConnect workspaceId={workspace.id} onClose={() => setGhostOpen(false)} />
      ) : null}


      {error ? (
        <p className="mb-6 rounded-2xl bg-coral/12 px-4 py-3 text-sm font-semibold text-coral">
          {error}
        </p>
      ) : null}

      {isGuest ? (
        <div className="mb-6 flex flex-wrap items-center gap-3 rounded-2xl border border-amber/40 bg-amber/10 p-4">
          <ShieldCheck className="size-5 shrink-0 text-coral" />
          <p className="flex-1 text-sm font-semibold">
            أنت تتصفح في وضع التجربة بدون تسجيل، ومساحة التجربة مشتركة بين الزوار — سجّل دخولك
            بحسابك أولاً ليُحفظ الربط في مساحتك أنت.
          </p>
          <a
            href="/auth"
            className="shrink-0 rounded-full bg-foreground px-3.5 py-1.5 text-xs font-bold text-background"
          >
            سجّل الدخول
          </a>
        </div>
      ) : null}

      <div className="mb-6 flex flex-wrap items-center gap-3 rounded-2xl border border-border bg-secondary/50 p-4">
        <Plug className="size-5 shrink-0 text-jade-deep" />
        <p className="flex-1 text-sm font-semibold">
          {pdReady === false
            ? "وسيط التكاملات (Pipedream) غير مفعّل بعد — أضف مفاتيح Pipedream ليعمل ربط منصات التواصل والبريد وCRM."
            : pdEnv === "development"
              ? "وسيط الربط يعمل حالياً بوضع التجريب — الربط لن ينجح إلا لمن لديه حساب على Pipedream. حوّل PIPEDREAM_ENVIRONMENT إلى production ليربط عملاؤك حساباتهم."
              : "منصات التواصل والبريد وCRM تُربط عبر Pipedream — لا نحتفظ بأي كلمات مرور أو توكنات لديك."}
        </p>
        <button
          onClick={() => void refresh()}
          disabled={busy === "sync" || !workspace}
          className="shrink-0 rounded-full bg-foreground px-3.5 py-1.5 text-xs font-bold text-background disabled:opacity-60"
        >
          {busy === "sync" ? "…" : "تحديث الحسابات"}
        </button>
      </div>

      {broken.length ? (
        <div className="mb-6 flex flex-wrap items-center gap-3 rounded-2xl border border-coral/30 bg-coral/8 p-4">
          <RefreshCw className="size-5 shrink-0 text-coral" />
          <p className="flex-1 text-sm font-semibold">
            {broken.length} حسابات تحتاج إعادة ربط — المهام المرتبطة بها متوقفة مؤقتاً.
          </p>
        </div>
      ) : null}


      {isLoading ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> جارٍ التحميل…
        </p>
      ) : (
        <div className="space-y-6">
          {team.map((m) => {
            const owned = all.filter((i) => i.employee_id === m.id);
            if (!owned.length) return null;
            return (
              <section key={m.id} className="rounded-3xl border border-border bg-card p-6">
                <div className="flex items-center gap-3">
                  <span
                    className="grid size-10 place-items-center rounded-2xl"
                    style={{ background: m.tintSoft, color: m.tint }}
                  >
                    <m.icon className="size-5" strokeWidth={2.2} />
                  </span>
                  <div>
                    <h2 className="font-display font-black">{m.name}</h2>
                    <p className="text-sm text-muted-foreground">{m.role}</p>
                  </div>
                </div>

                <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {owned.map((i) => (
                    <div
                      key={i.id}
                      className="flex items-center gap-3 rounded-2xl border border-border/70 p-4"
                    >
                      <AppIcon name={i.provider} className="size-6 shrink-0" />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2 truncate text-sm font-bold">
                          {appLabel(i.provider)}
                          {realProviders.has(i.provider) ? (
                            <span className="shrink-0 rounded-full bg-jade/12 px-2 py-0.5 text-[0.65rem] font-bold text-jade-deep">
                              ربط مباشر
                            </span>
                          ) : isPipedreamProvider(i.provider) ? (
                            <span className="shrink-0 rounded-full bg-sky/12 px-2 py-0.5 text-[0.65rem] font-bold text-sky">
                              عبر Pipedream
                            </span>
                          ) : null}
                        </span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {i.account ??
                            pipedreamApp(i.provider)?.note ??
                            "لم يُربط بعد"}
                        </span>
                      </span>

                      <button
                        onClick={() => void toggle(i.id, i.status, i.provider)}
                        disabled={busy === i.id}
                        className={cn(
                          "shrink-0 rounded-full px-3.5 py-1.5 text-xs font-bold transition-colors disabled:opacity-60",
                          i.status === "connected" && "bg-jade/12 text-jade-deep",
                          i.status === "error" && "bg-coral text-background",
                          i.status === "disconnected" && "bg-foreground text-background",
                        )}
                      >
                        {busy === i.id
                          ? "…"
                          : i.status === "connected"
                            ? integrationStatusLabel.connected
                            : i.status === "error"
                              ? "أعد الربط"
                              : "اربط"}
                      </button>
                    </div>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}

      <div className="mt-6 flex items-start gap-3 rounded-3xl border border-border bg-secondary/50 p-6">
        <ShieldCheck className="size-5 shrink-0 text-jade-deep" />
        <p className="text-sm leading-relaxed text-ink-soft">
          الربط يتم عبر OAuth الرسمي لكل منصة — لا نطلب كلمات مرورك أبداً، ويمكنك فصل أي حساب بضغطة
          واحدة.
        </p>
      </div>
    </AppShell>
  );
}
