/**
 * تكييف نص المنشور لكل منصة + اقتراح أفضل وقت للنشر.
 * ملف محايد (يعمل على المتصفح والخادم) حتى تستعمله لوحة النشر والطيار الآلي بنفس المنطق.
 */

/** نسخة مختصرة تناسب حدّ إكس (٢٨٠ حرفاً) وتنتهي عند جملة كاملة مع أهم هاشتاقين. */
export function shortForX(caption: string): string {
  const tags = (caption.match(/#[\p{L}\p{N}_]+/gu) ?? []).slice(0, 2).join(" ");
  const text = caption.replace(/#[\p{L}\p{N}_]+/gu, "").replace(/\n{2,}/g, "\n").trim();
  const budget = 275 - (tags ? tags.length + 1 : 0);
  if (text.length <= budget) return [text, tags].filter(Boolean).join("\n");
  const cut = text.slice(0, budget);
  const stop = Math.max(
    cut.lastIndexOf("."),
    cut.lastIndexOf("!"),
    cut.lastIndexOf("؟"),
    cut.lastIndexOf("\n"),
  );
  return [(stop > 80 ? cut.slice(0, stop + 1) : cut).trim(), tags].filter(Boolean).join("\n");
}

/** حدود النص المعروفة لكل منصة. */
const LIMIT: Record<string, number> = {
  x: 280,
  instagram: 2200,
  facebook: 5000,
  linkedin: 3000,
  pinterest: 480,
  youtube: 5000,
};

/** يعيد نص المنشور مكيّفاً لحدود المنصة المطلوبة. */
export function adaptForProvider(provider: string, caption: string): string {
  if (provider === "x") return shortForX(caption);
  const limit = LIMIT[provider];
  return limit && caption.length > limit ? `${caption.slice(0, limit - 1).trim()}…` : caption;
}

/** أفضل ساعات النشر (بالتوقيت المحلي للمستخدم) لكل منصة — متوسطات تفاعل معروفة. */
const BEST_HOURS: Record<string, number[]> = {
  instagram: [11, 14, 20],
  facebook: [10, 13, 21],
  linkedin: [8, 10, 12],
  x: [9, 12, 18],
  pinterest: [14, 20, 22],
  youtube: [16, 19, 21],
};

/** أقرب «أفضل وقت» قادم للمنصة (بعد ٢٠ دقيقة على الأقل من الآن). */
export function bestTimeFor(provider: string, from: Date = new Date()): Date {
  const hours = BEST_HOURS[provider] ?? [10, 14, 20];
  const floor = new Date(from.getTime() + 20 * 60_000);
  for (let day = 0; day < 2; day += 1) {
    for (const hour of hours) {
      const candidate = new Date(floor);
      candidate.setDate(floor.getDate() + day);
      candidate.setHours(hour, 0, 0, 0);
      if (candidate > floor) return candidate;
    }
  }
  return new Date(floor.getTime() + 3_600_000);
}
