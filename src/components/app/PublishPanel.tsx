import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { CalendarClock, Loader2, Send, Link2, Sparkles } from "lucide-react";
import { Link } from "@tanstack/react-router";

import { AppIcon, appLabel } from "@/components/site/AppIcon";
import { useConnectedAccounts } from "@/lib/data";
import { adaptForProvider, bestTimeFor } from "@/lib/post-format";
import { publishSocialNow, scheduleSocialPost } from "@/lib/social-queue.functions";

/** المنصات التي يدعمها سِراج للنشر المباشر من داخل «سهل». */
const PUBLISHABLE = ["instagram", "facebook", "linkedin", "x", "pinterest", "youtube"] as const;


/** يلتقط أول صورة داخل المخرج (رابط مباشر أو صيغة ماركداون). */
export function imageFromOutput(text: string | null | undefined): string | null {
  if (!text) return null;
  const md = /!\[[^\]]*\]\((https?:\/\/[^\s)]+)\)/.exec(text);
  if (md?.[1]) return md[1];
  const raw = /(https?:\/\/\S+\.(?:png|jpe?g|webp))/i.exec(text);
  return raw?.[1] ?? null;
}

/** يزيل صيغ الماركداون من نص المنشور قبل إرساله للمنصة. */
function cleanBody(text: string): string {
  return text
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/^#{1,6}\s*/gm, "")
    .replace(/\*\*/g, "")
    .trim();
}

function localInputValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

type Props = {
  workspaceId: string;
  employeeId: string;
  taskId?: string | null;
  channel: string;
  body: string;
  onPublished?: () => void;
};

/** لوحة النشر: تختار المنصة المربوطة ثم تنشر الآن أو تجدول لموعد. */
export function PublishPanel({
  workspaceId,
  employeeId,
  taskId,
  channel,
  body,
  onPublished,
}: Props) {
  const qc = useQueryClient();
  const { data: accounts, isLoading } = useConnectedAccounts(workspaceId);

  const connected = useMemo(
    () =>
      (accounts ?? [])
        .map((a) => a.provider)
        .filter((p): p is (typeof PUBLISHABLE)[number] =>
          (PUBLISHABLE as readonly string[]).includes(p),
        ),
    [accounts],
  );

  // اختيار متعدد مثل مدير التواصل الاحترافي: منشور واحد يخرج على كل المنصات المختارة.
  const [picked, setPicked] = useState<string[] | null>(null);
  const active = useMemo(() => {
    if (picked) return picked.filter((p) => connected.includes(p as never));
    const preferred = connected.includes(channel as never) ? channel : connected[0];
    return preferred ? [preferred] : [];
  }, [picked, connected, channel]);

  const toggle = (p: string) =>
    setPicked((prev) => {
      const base = prev ?? active;
      return base.includes(p) ? base.filter((x) => x !== p) : [...base, p];
    });

  const [when, setWhen] = useState(() => localInputValue(new Date(Date.now() + 3_600_000)));
  const [busy, setBusy] = useState<"now" | "later" | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const imageUrl = imageFromOutput(body);
  const text = cleanBody(body);

  const done = (message: string) => {
    setNote(message);
    void qc.invalidateQueries({ queryKey: ["social-posts", workspaceId] });
    void qc.invalidateQueries({ queryKey: ["tasks", workspaceId] });
    onPublished?.();
  };

  /** يقترح أفضل موعد نشر للمنصة الأولى المختارة. */
  const suggestBestTime = () => {
    const target = active[0];
    if (!target) return;
    const at = bestTimeFor(target);
    setWhen(localInputValue(at));
    setNote(`أفضل وقت مقترح لـ${appLabel(target)}: ${at.toLocaleString("ar-EG")}`);
  };

  const run = async (mode: "now" | "later") => {
    if (!active.length) return;
    setBusy(mode);
    setNote(null);

    const at = mode === "later" ? new Date(when) : null;
    if (at && Number.isNaN(at.getTime())) {
      setNote("موعد غير صالح.");
      setBusy(null);
      return;
    }

    const ok: string[] = [];
    const failed: string[] = [];

    for (const provider of active) {
      // إنستجرام لا يقبل منشوراً بلا صورة — نوضّح السبب بدل فشل غامض.
      if (provider === "instagram" && !imageUrl) {
        failed.push(`${appLabel(provider)}: يحتاج صورة`);
        continue;
      }
      const base = {
        workspaceId,
        employeeId,
        taskId: taskId ?? null,
        provider,
        body: adaptForProvider(provider, text),
        imageUrl: imageUrl ?? null,
      };
      try {
        if (at) await scheduleSocialPost({ data: { ...base, scheduledAt: at.toISOString() } });
        else await publishSocialNow({ data: base });
        ok.push(appLabel(provider));
      } catch (e) {
        failed.push(`${appLabel(provider)}: ${e instanceof Error ? e.message : "تعذّر التنفيذ"}`);
      }
    }

    const head = ok.length
      ? at
        ? `تمت الجدولة على ${ok.join("، ")} في ${at.toLocaleString("ar-EG")} ⏱`
        : `تم النشر على ${ok.join("، ")} ✅`
      : "";
    done([head, ...failed].filter(Boolean).join("\n"));
    setBusy(null);
  };


  if (isLoading) {
    return (
      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" /> نتحقق من حساباتك المربوطة…
      </p>
    );
  }

  if (!connected.length) {
    return (
      <Link
        to="/app/integrations"
        className="inline-flex items-center gap-2 rounded-full border border-border px-4 py-2.5 text-sm font-bold transition-colors hover:bg-secondary"
      >
        <Link2 className="size-4" /> اربط حساباتك للنشر المباشر
      </Link>
    );
  }

  return (
    <div className="mt-4 rounded-2xl border border-border bg-secondary/30 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-bold text-muted-foreground">انشر على</span>
        {connected.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => toggle(p)}
            aria-pressed={active.includes(p)}
            className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold transition-colors ${
              active.includes(p)
                ? "border-foreground bg-foreground text-background"
                : "border-border hover:bg-secondary"
            }`}
          >
            <AppIcon name={p} className="size-3.5" />
            {appLabel(p)}
          </button>
        ))}
      </div>

      {active.includes("instagram") && !imageUrl ? (
        <p className="mt-3 text-xs text-muted-foreground">
          إنستجرام يتطلّب صورة — اطلب من سِراج توليد صورة للمنشور أولاً.
        </p>
      ) : null}
      {active.includes("x") ? (
        <p className="mt-2 text-xs text-muted-foreground">
          نسخة إكس تُقصَّر تلقائياً إلى ٢٨٠ حرفاً مع أهم هاشتاقين.
        </p>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void run("now")}
          disabled={!!busy || !active.length}
          className="inline-flex items-center gap-2 rounded-full bg-foreground px-5 py-2.5 text-sm font-bold text-background disabled:opacity-60"
        >
          {busy === "now" ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
          انشر الآن
        </button>

        <input
          type="datetime-local"
          value={when}
          onChange={(e) => setWhen(e.target.value)}
          aria-label="موعد النشر"
          className="rounded-full border border-border bg-card px-4 py-2 text-sm"
        />

        <button
          type="button"
          onClick={suggestBestTime}
          disabled={!active.length}
          className="inline-flex items-center gap-2 rounded-full border border-border px-4 py-2.5 text-sm font-bold transition-colors hover:bg-secondary disabled:opacity-60"
        >
          <Sparkles className="size-4" /> أفضل وقت
        </button>

        <button
          type="button"
          onClick={() => void run("later")}
          disabled={!!busy || !active.length}
          className="inline-flex items-center gap-2 rounded-full border border-border px-4 py-2.5 text-sm font-bold transition-colors hover:bg-secondary disabled:opacity-60"
        >
          {busy === "later" ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <CalendarClock className="size-4" />
          )}
          جدولة
        </button>
      </div>


      {note ? (
        <p className="mt-3 whitespace-pre-line text-xs font-bold text-ink-soft">{note}</p>
      ) : null}

    </div>
  );
}
