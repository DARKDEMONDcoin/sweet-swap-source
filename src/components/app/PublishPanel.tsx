import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  CalendarClock,
  Loader2,
  Send,
  Link2,
  Sparkles,
  ImagePlus,
  ImageOff,
  Pencil,
  Plus,
  Trash2,
  Film,
} from "lucide-react";
import { Link } from "@tanstack/react-router";

import { AppIcon, appLabel } from "@/components/site/AppIcon";
import { useConnectedAccounts } from "@/lib/data";
import { adaptForProvider, bestTimeFor } from "@/lib/post-format";
import { PUBLISHABLE, requestedPublishTargets, providerLabel } from "@/lib/platforms";
import { publishSocialNow, scheduleSocialPost, uploadSocialMedia } from "@/lib/social-queue.functions";

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
    .replace(/\n{3,}/g, "\n\n")
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
  /** القناة التي اقترحها الموظف. */
  channel: string;
  /** رسالة المستخدم الأصلية — لنفهم المنصة التي طلبها هو بالضبط. */
  request?: string | null;
  body: string;
  onPublished?: () => void;
};

type Media = { url: string; kind: "image" | "video"; label: string };

/**
 * لوحة النشر: تحترم المنصة التي طلبها المستخدم (لا تبدّلها بغيرها صامتةً)، وتترك له
 * كامل الحرية: تعديل النص يدوياً، إبقاء الصورة المولّدة أو حذفها أو رفع صورة/فيديو من جهازه،
 * والنشر الآن أو جدولة أكثر من موعد.
 */
export function PublishPanel({ workspaceId, employeeId, taskId, channel, request, body, onPublished }: Props) {
  const qc = useQueryClient();
  const upload = useServerFn(uploadSocialMedia);
  const { data: accounts, isLoading } = useConnectedAccounts(workspaceId);

  const connected = useMemo(
    () =>
      (accounts ?? [])
        .map((a) => a.provider)
        .filter((p): p is (typeof PUBLISHABLE)[number] => (PUBLISHABLE as readonly string[]).includes(p)),
    [accounts],
  );

  /** المنصات التي طلبها المستخدم بكلامه، ثم قناة الموظف، بهذا الترتيب. */
  const requested = useMemo(() => {
    const fromUser = request ? requestedPublishTargets(request) : [];
    const list = [...fromUser];
    if (!list.length && (PUBLISHABLE as readonly string[]).includes(channel)) list.push(channel as never);
    return [...new Set(list)];
  }, [request, channel]);

  const missing = requested.filter((p) => !connected.includes(p as never));

  const [picked, setPicked] = useState<string[] | null>(null);
  const active = useMemo(() => {
    if (picked) return picked.filter((p) => connected.includes(p as never));
    // لا نبدّل المنصة المطلوبة بأخرى: إن لم تكن مربوطة، نُظهر زر الربط بدل النشر في مكان آخر.
    const wanted = requested.filter((p) => connected.includes(p as never));
    if (wanted.length) return wanted;
    return requested.length ? [] : connected.slice(0, 1);
  }, [picked, connected, requested]);

  const toggle = (p: string) =>
    setPicked((prev) => {
      const base = prev ?? active;
      return base.includes(p) ? base.filter((x) => x !== p) : [...base, p];
    });

  // النص قابل للتعديل يدوياً دائماً.
  const [text, setText] = useState(() => cleanBody(body));
  const [editing, setEditing] = useState(false);
  useEffect(() => setText(cleanBody(body)), [body]);

  // الوسائط: الصورة المولّدة افتراضياً، ويمكن حذفها أو استبدالها برفع من الجهاز.
  const generated = imageFromOutput(body);
  const [media, setMedia] = useState<Media | null>(() =>
    generated ? { url: generated, kind: "image", label: "الصورة المولّدة" } : null,
  );
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // مواعيد متعددة: المستخدم يختار الكمية والأوقات التي يريدها.
  const [slots, setSlots] = useState<string[]>(() => [localInputValue(new Date(Date.now() + 3_600_000))]);
  const [busy, setBusy] = useState<"now" | "later" | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const done = (message: string) => {
    setNote(message);
    void qc.invalidateQueries({ queryKey: ["social-posts", workspaceId] });
    void qc.invalidateQueries({ queryKey: ["tasks", workspaceId] });
    onPublished?.();
  };

  const suggestBestTime = (index: number) => {
    const target = active[0];
    if (!target) return;
    const at = bestTimeFor(target, index ? new Date(slots[index - 1] ?? Date.now()) : new Date());
    setSlots((s) => s.map((v, i) => (i === index ? localInputValue(at) : v)));
    setNote(`أفضل وقت مقترح لـ${appLabel(target)}: ${at.toLocaleString("ar-EG")}`);
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    setNote(null);
    try {
      const fd = new FormData();
      fd.set("workspaceId", workspaceId);
      fd.set("file", file);
      const r = await upload({ data: fd });
      setMedia({ url: r.url, kind: r.kind, label: r.name });
    } catch (e) {
      setNote(e instanceof Error ? e.message : "تعذّر رفع الملف.");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const run = async (mode: "now" | "later") => {
    if (!active.length) return;
    if (!text.trim()) {
      setNote("نص المنشور فارغ.");
      return;
    }
    setBusy(mode);
    setNote(null);

    const dates = mode === "later" ? slots.map((s) => new Date(s)) : [null];
    if (dates.some((d) => d && Number.isNaN(d.getTime()))) {
      setNote("أحد المواعيد غير صالح.");
      setBusy(null);
      return;
    }

    const ok: string[] = [];
    const failed: string[] = [];
    const imageUrl = media?.kind === "image" ? media.url : null;
    const videoUrl = media?.kind === "video" ? media.url : null;

    for (const at of dates) {
      for (const provider of active) {
        if (provider === "instagram" && !media) {
          failed.push(`${appLabel(provider)}: يحتاج صورة أو فيديو`);
          continue;
        }
        if (videoUrl && provider !== "facebook" && provider !== "instagram") {
          failed.push(`${appLabel(provider)}: نشر الفيديو متاح على فيسبوك وإنستجرام فقط`);
          continue;
        }
        const base = {
          workspaceId,
          employeeId,
          taskId: taskId ?? null,
          provider,
          body: adaptForProvider(provider, text.trim()),
          imageUrl,
          videoUrl,
        };
        try {
          if (at) await scheduleSocialPost({ data: { ...base, scheduledAt: at.toISOString() } });
          else await publishSocialNow({ data: base });
          ok.push(at ? `${appLabel(provider)} (${at.toLocaleString("ar-EG", { dateStyle: "short", timeStyle: "short" })})` : appLabel(provider));
        } catch (e) {
          failed.push(`${appLabel(provider)}: ${e instanceof Error ? e.message : "تعذّر التنفيذ"}`);
        }
      }
    }

    const head = ok.length
      ? mode === "later"
        ? `تمت الجدولة ⏱ ${ok.join("، ")}`
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
        <Link2 className="size-4" />
        {requested[0] ? `اربط ${providerLabel(requested[0])} للنشر مباشرة` : "اربط حساباتك للنشر المباشر"}
      </Link>
    );
  }

  const chipClass = (on: boolean) =>
    `inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold transition-colors ${
      on ? "border-foreground bg-foreground text-background" : "border-border hover:bg-secondary"
    }`;

  return (
    <div className="mt-4 rounded-2xl border border-border bg-secondary/30 p-4">
      {/* المنصات */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-bold text-muted-foreground">انشر على</span>
        {connected.map((p) => (
          <button key={p} type="button" onClick={() => toggle(p)} aria-pressed={active.includes(p)} className={chipClass(active.includes(p))}>
            <AppIcon name={p} className="size-3.5" />
            {appLabel(p)}
          </button>
        ))}
        {missing.map((p) => (
          <Link
            key={p}
            to="/app/integrations"
            className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-amber/60 bg-amber/10 px-3 py-1.5 text-xs font-bold text-ink-soft hover:bg-amber/20"
            title={`${providerLabel(p)} غير مربوط — اضغط للربط`}
          >
            <AppIcon name={p} className="size-3.5" />
            {providerLabel(p)} · اربطه أولاً
          </Link>
        ))}
      </div>
      {missing.length && !active.length ? (
        <p className="mt-2 text-xs font-bold text-coral">
          طلبت النشر على {missing.map(providerLabel).join(" و")} وهو غير مربوط بعد — لن نبدّله بمنصة أخرى دون إذنك. اربطه أو اختر منصة أخرى يدوياً.
        </p>
      ) : null}

      {/* النص */}
      <div className="mt-4">
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold text-muted-foreground">نص المنشور</span>
          <button type="button" onClick={() => setEditing((v) => !v)} className="inline-flex items-center gap-1 text-xs font-bold hover:underline">
            <Pencil className="size-3.5" /> {editing ? "إنهاء التعديل" : "عدّل يدوياً"}
          </button>
        </div>
        {editing ? (
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={Math.min(14, Math.max(4, text.split("\n").length + 1))}
            dir="auto"
            className="mt-2 w-full rounded-xl border border-border bg-card p-3 text-sm leading-relaxed outline-none focus:ring-2 focus:ring-foreground/20"
          />
        ) : (
          <p className="mt-2 line-clamp-4 whitespace-pre-line rounded-xl bg-card/60 p-3 text-sm leading-relaxed text-ink-soft" dir="auto">
            {text}
          </p>
        )}
        <p className="mt-1 text-[11px] text-muted-foreground">
          {text.length.toLocaleString("en-US")} حرف
          {active.includes("x") ? " · نسخة إكس تُقصَّر تلقائياً إلى ٢٨٠ حرفاً" : ""}
        </p>
      </div>

      {/* الوسائط */}
      <div className="mt-4">
        <span className="text-xs font-bold text-muted-foreground">الصورة / الفيديو</span>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          {media ? (
            <div className="relative overflow-hidden rounded-xl border border-border bg-card">
              {media.kind === "image" ? (
                <img src={media.url} alt="" className="h-24 w-24 object-cover" loading="lazy" />
              ) : (
                <video src={media.url} className="h-24 w-24 object-cover" muted playsInline />
              )}
              <span className="absolute inset-x-0 bottom-0 truncate bg-foreground/70 px-1 py-0.5 text-[10px] text-background">
                {media.kind === "video" ? "فيديو" : media.label}
              </span>
            </div>
          ) : (
            <div className="flex h-24 w-24 items-center justify-center rounded-xl border border-dashed border-border text-muted-foreground">
              <ImageOff className="size-5" />
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs font-bold hover:bg-secondary disabled:opacity-60"
            >
              {uploading ? <Loader2 className="size-3.5 animate-spin" /> : <ImagePlus className="size-3.5" />}
              ارفع من جهازك
            </button>
            {generated && media?.url !== generated ? (
              <button
                type="button"
                onClick={() => setMedia({ url: generated, kind: "image", label: "الصورة المولّدة" })}
                className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs font-bold hover:bg-secondary"
              >
                <Sparkles className="size-3.5" /> استخدم الصورة المولّدة
              </button>
            ) : null}
            {media ? (
              <button
                type="button"
                onClick={() => setMedia(null)}
                className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs font-bold hover:bg-secondary"
              >
                <Trash2 className="size-3.5" /> بدون وسائط
              </button>
            ) : null}
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime"
              className="hidden"
              onChange={(e) => void onFile(e.target.files?.[0])}
            />
          </div>
        </div>
        {media?.kind === "video" ? (
          <p className="mt-2 inline-flex items-center gap-1 text-[11px] text-muted-foreground">
            <Film className="size-3.5" /> الفيديو يُنشر على فيسبوك وإنستجرام (Reels عمودي حتى ٩٠ ثانية).
          </p>
        ) : null}
        {active.includes("instagram") && !media ? (
          <p className="mt-2 text-xs text-muted-foreground">إنستجرام يتطلّب صورة أو فيديو — أبقِ الصورة المولّدة أو ارفع من جهازك.</p>
        ) : null}
      </div>

      {/* المواعيد */}
      <div className="mt-4">
        <span className="text-xs font-bold text-muted-foreground">مواعيد الجدولة (اختياري — أضف ما تشاء)</span>
        <div className="mt-2 space-y-2">
          {slots.map((s, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2">
              <input
                type="datetime-local"
                value={s}
                onChange={(e) => setSlots((all) => all.map((v, j) => (j === i ? e.target.value : v)))}
                aria-label={`موعد النشر ${i + 1}`}
                className="rounded-full border border-border bg-card px-4 py-2 text-sm"
              />
              <button
                type="button"
                onClick={() => suggestBestTime(i)}
                disabled={!active.length}
                className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-2 text-xs font-bold hover:bg-secondary disabled:opacity-60"
              >
                <Sparkles className="size-3.5" /> أفضل وقت
              </button>
              {slots.length > 1 ? (
                <button type="button" onClick={() => setSlots((all) => all.filter((_, j) => j !== i))} aria-label="حذف الموعد" className="rounded-full p-2 text-muted-foreground hover:bg-secondary">
                  <Trash2 className="size-4" />
                </button>
              ) : null}
            </div>
          ))}
          {slots.length < 10 ? (
            <button
              type="button"
              onClick={() => setSlots((all) => [...all, localInputValue(new Date(new Date(all[all.length - 1] ?? Date.now()).getTime() + 86_400_000))])}
              className="inline-flex items-center gap-1 text-xs font-bold hover:underline"
            >
              <Plus className="size-3.5" /> موعد آخر
            </button>
          ) : null}
        </div>
      </div>

      {/* الإجراءات */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void run("now")}
          disabled={!!busy || uploading || !active.length}
          className="inline-flex items-center gap-2 rounded-full bg-foreground px-5 py-2.5 text-sm font-bold text-background disabled:opacity-60"
        >
          {busy === "now" ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
          انشر الآن
        </button>
        <button
          type="button"
          onClick={() => void run("later")}
          disabled={!!busy || uploading || !active.length}
          className="inline-flex items-center gap-2 rounded-full border border-border px-4 py-2.5 text-sm font-bold transition-colors hover:bg-secondary disabled:opacity-60"
        >
          {busy === "later" ? <Loader2 className="size-4 animate-spin" /> : <CalendarClock className="size-4" />}
          جدولة {slots.length > 1 ? `(${slots.length.toLocaleString("en-US")} مواعيد)` : ""}
        </button>
      </div>

      {note ? <p className="mt-3 whitespace-pre-line text-xs font-bold text-ink-soft">{note}</p> : null}
    </div>
  );
}
