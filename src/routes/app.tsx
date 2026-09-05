import { createFileRoute, Outlet } from "@tanstack/react-router";
import { Sparkles } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { guestSession } from "@/lib/guest.functions";

export const Route = createFileRoute("/app")({
  ssr: false,
  beforeLoad: async () => {
    const { data } = await supabase.auth.getUser();
    if (data.user) return { user: data.user };

    // لا تسجيل: نفتح جلسة تجربة تلقائياً
    const { tokenHash } = await guestSession();
    const { data: verified, error } = await supabase.auth.verifyOtp({
      type: "email",
      token_hash: tokenHash,
    });
    if (error || !verified.user) throw new Error(error?.message ?? "تعذّر فتح جلسة التجربة");
    return { user: verified.user };
  },
  head: () => ({ meta: [{ name: "robots", content: "noindex" }] }),
  pendingMs: 150,
  pendingComponent: () => (
    <div className="grid min-h-dvh place-items-center bg-background px-6 text-center">
      <div>
        <span
          className="mx-auto grid size-14 animate-pulse place-items-center rounded-2xl text-primary-foreground"
          style={{ backgroundImage: "var(--gradient-aurora)" }}
        >
          <Sparkles className="size-6" />
        </span>
        <p className="mt-4 font-display text-lg font-black">نجهّز مساحة عملك…</p>
        <p className="mt-1 text-sm text-muted-foreground">ثوانٍ قليلة ويكون فريقك جاهزًا.</p>
      </div>
    </div>
  ),
  errorComponent: ({ error }) => (
    <div className="grid min-h-dvh place-items-center bg-background px-6 text-center">
      <div className="max-w-md">
        <p className="font-display text-lg font-black">تعذّر فتح مساحة العمل</p>
        <p className="mt-2 text-sm text-muted-foreground">{error.message}</p>
        <a
          href="/app"
          className="mt-4 inline-block rounded-xl bg-foreground px-4 py-2 text-sm font-bold text-background"
        >
          حاول مرة أخرى
        </a>
      </div>
    </div>
  ),
  component: () => <Outlet />,
});
