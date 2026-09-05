/**
 * مصدر واحد لحقيقة الأسعار — تستخدمه صفحة /pricing وقسم الأسعار في الصفحة الرئيسية
 * حتى لا تختلف الأرقام أو أسماء الباقات بين مكانين.
 */
export type Plan = {
  id: "start" | "growth" | "scale";
  name: string;
  /** السعر الشهري بالريال، أو null للباقة حسب الطلب. */
  monthly: number | null;
  tag: string;
  desc: string;
  highlight: boolean;
  cta: string;
  perks: string[];
};

/** خصم الاشتراك السنوي. */
export const yearlyDiscount = 0.2;

export const plans: Plan[] = [
  {
    id: "start",
    name: "البداية",
    monthly: 149,
    tag: "لصاحب مشروع يبدأ وحده",
    desc: "موظف رقمي واحد تختاره ويبدأ العمل اليوم.",
    highlight: false,
    cta: "ابدأ ١٤ يوماً مجاناً",
    perks: [
      "موظف رقمي واحد تختاره",
      "٣ حسابات مرتبطة",
      "٦٠ مهمة شهرياً",
      "توليد صور بنص عربي",
      "تقرير أسبوعي",
      "دعم بالبريد خلال ٢٤ ساعة",
    ],
  },
  {
    id: "growth",
    name: "النمو",
    monthly: 399,
    tag: "الأكثر اختياراً",
    desc: "الفريق الستة كاملاً بمسارات عمل تلقائية بينهم.",
    highlight: true,
    cta: "ابدأ ١٤ يوماً مجاناً",
    perks: [
      "الفريق الستة كاملاً",
      "حسابات غير محدودة",
      "١٠٠٠ مهمة شهرياً",
      "مسارات عمل تلقائية بين الموظفين",
      "صندوق موحّد للعملاء",
      "ذاكرة علامة تجارية متقدمة",
      "دعم أولوية خلال ٣ ساعات",
    ],
  },
  {
    id: "scale",
    name: "المؤسسات",
    monthly: null,
    tag: "لفرق متعددة الفروع والعلامات",
    desc: "علامات وفروع متعددة بصلاحيات ومدير حساب.",
    highlight: false,
    cta: "تحدّث مع المبيعات",
    perks: [
      "علامات وفروع متعددة",
      "صلاحيات وأدوار للفريق",
      "مهام غير محدودة",
      "سجل تدقيق كامل واتفاقية مستوى خدمة",
      "مدير حساب مخصص",
      "تدريب الفريق وإعداد أولي",
    ],
  },
];

/** السعر المعروض حسب دورة الفوترة المختارة. */
export function priceOf(plan: Plan, yearly: boolean): string {
  if (plan.monthly === null) return "حسب الطلب";
  return String(yearly ? Math.round(plan.monthly * (1 - yearlyDiscount)) : plan.monthly);
}
