import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";

import { Portrait } from "@/components/site/Portrait";
import { cn } from "@/lib/utils";

/** عبارات تتبدّل أثناء عمل الموظف — لكل موظف لمسته. */
const PHASES: Record<string, string[]> = {
  nour: [
    "تقرأ عقل العلامة…",
    "تحلّل نية البحث…",
    "تصوغ المخرج بعربية طبيعية…",
    "تراجع الجودة قبل التسليم…",
  ],
  sonny: [
    "يقرأ نبرة علامتك…",
    "يدرس ما ينجح على المنصة…",
    "يصوغ منشوراً يوقف التمرير…",
    "يضبط الهاشتاقات والتوقيت…",
  ],
  eva: ["تراجع سجل العميل…", "تفهم السياق…", "تكتب رداً مهذباً وحاسماً…"],
  sam: ["يحلّل البيانات…", "يبحث عن الفرصة الأقرب…", "يجهّز الخطوة التالية…"],
  dana: ["تدرس هوية العلامة…", "تجرّب الألوان والتكوين…", "تُخرج التصميم بلمسة نهائية…"],
  adam: ["يراجع الأرقام…", "يرصد الأنماط…", "يكتب التقرير بوضوح…"],
};
const FALLBACK = ["يقرأ طلبك…", "يفكّر…", "يجهّز المخرج…"];

export function Thinking({
  memberId,
  name,
  className,
}: {
  memberId: string;
  name: string;
  className?: string;
}) {
  const phases = PHASES[memberId] ?? FALLBACK;
  const [i, setI] = useState(0);

  useEffect(() => {
    const t = setInterval(() => setI((v) => (v + 1) % phases.length), 2400);
    return () => clearInterval(t);
  }, [phases.length]);

  return (
    <div
      className={cn("flex justify-end gap-3 animate-bubble-in", className)}
      role="status"
      aria-live="polite"
      aria-label={`${name} يعمل على طلبك`}
    >
      <span className="relative order-2 block size-9 shrink-0 rounded-xl">
        <span className="absolute inset-0 rounded-xl animate-pulse-ring" />
        <span className="relative block size-full overflow-hidden rounded-xl shadow-sm">
          <Portrait memberId={memberId} name={name} className="size-full" />
        </span>
        <span className="absolute -bottom-1 -start-1 grid size-4 place-items-center rounded-full bg-primary text-primary-foreground shadow-sm">
          <Sparkles className="size-2.5" strokeWidth={2.8} />
        </span>
      </span>

      <div className="order-1 w-[min(30rem,88%)] rounded-3xl rounded-se-lg border border-border bg-card px-5 py-4 shadow-sm">
        <div className="flex items-center gap-2.5">
          <span className="flex items-end gap-1" aria-hidden>
            <span className="size-1.5 rounded-full bg-primary think-dot" />
            <span className="size-1.5 rounded-full bg-primary think-dot [animation-delay:0.18s]" />
            <span className="size-1.5 rounded-full bg-primary think-dot [animation-delay:0.36s]" />
          </span>
          <span key={i} className="text-sm font-bold shimmer-text animate-fade-in">
            {name} {phases[i]}
          </span>
        </div>
        <div className="mt-3.5 space-y-2" aria-hidden>
          <span className="block h-2.5 w-[92%] rounded-full shimmer-line" />
          <span className="block h-2.5 w-[74%] rounded-full shimmer-line [animation-delay:0.2s]" />
          <span className="block h-2.5 w-[58%] rounded-full shimmer-line [animation-delay:0.4s]" />
        </div>
      </div>
    </div>
  );
}
