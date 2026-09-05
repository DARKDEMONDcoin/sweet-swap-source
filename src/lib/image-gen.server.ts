/**
 * توليد الصور لنور — مجاني وبلا حدود يومية وبلا مفتاح API.
 *
 * المزوّد الأساسي: Pollinations.ai (نموذج FLUX) — يرجع صورة مباشرة عبر رابط دائم،
 * بلا تسجيل ولا مفتاح ولا حصة يومية. نحفظ الرابط كما هو داخل المقال (CDN مجاني)،
 * أو نرفع البايتات إلى Supabase Storage عند الحاجة لملكية كاملة للأصل.
 *
 * الاحتياطي: Gemini image (المفتاح موجود أصلاً) عند فشل المزوّد الأساسي.
 */

const POLLINATIONS = "https://image.pollinations.ai/prompt";

export type ImageOptions = {
  width?: number;
  height?: number;
  /** ثابت يجعل نفس الوصف يعطي نفس الصورة (مفيد لإعادة التوليد المتوقّعة). */
  seed?: number;
  timeoutMs?: number;
};

/** رابط صورة جاهز للاستخدام مباشرة داخل Markdown/HTML — لا يحتاج انتظار توليد. */
export function imageUrl(prompt: string, opts: ImageOptions = {}): string {
  const { width = 1216, height = 640, seed } = opts;
  const q = new URLSearchParams({
    width: String(width),
    height: String(height),
    model: "flux",
    nologo: "true",
    enhance: "true",
    ...(seed !== undefined ? { seed: String(seed) } : {}),
  });
  return `${POLLINATIONS}/${encodeURIComponent(prompt.slice(0, 900))}?${q}`;
}

/** يولّد الصورة فعلياً ويعيد بايتاتها (للرفع إلى التخزين أو النشر إلى ووردبريس). */
export async function generateImageBytes(
  prompt: string,
  opts: ImageOptions = {},
): Promise<{ bytes: Uint8Array; contentType: string; url: string } | null> {
  const { limitImage } = await import("./limiter.server");
  // المزوّد المجاني يرفض تحت الضغط المتوازي — ننظّم التزامن ثم نعيد المحاولة
  // بتأخير متصاعد قبل السقوط إلى Gemini، فلا يخرج المنشور بلا صورة.
  return limitImage(async () => {
    for (let attempt = 0; attempt < 4; attempt++) {
      const url = imageUrl(prompt, opts.seed !== undefined ? opts : { ...opts, seed: attempt });
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 90_000);
      try {
        const res = await fetch(url, { signal: controller.signal });
        if (!res.ok) throw new Error(`pollinations ${res.status}`);
        const buf = new Uint8Array(await res.arrayBuffer());
        if (buf.byteLength < 2000) throw new Error("صورة فارغة");
        return { bytes: buf, contentType: res.headers.get("content-type") ?? "image/jpeg", url };
      } catch (error) {
        console.error(`[nour] pollinations attempt ${attempt + 1} failed:`, error);
        if (attempt < 3) await new Promise((r) => setTimeout(r, 2000 * 2 ** attempt + Math.random() * 900));
      } finally {
        clearTimeout(timer);
      }
    }
    return geminiImage(prompt);
  });
}



/** احتياطي: توليد الصورة عبر Gemini image بمفتاح Google AI Studio المخزَّن في Supabase. */
async function geminiImage(
  prompt: string,
): Promise<{ bytes: Uint8Array; contentType: string; url: string } | null> {
  try {
    const { providerKeys } = await import("./provider-keys.server");
    const { gemini } = await providerKeys();
    if (!gemini) return null;
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-image:generateContent?key=${gemini}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: { responseModalities: ["TEXT", "IMAGE"] },
        }),
      },
    );
    if (!res.ok) return null;
    const json = (await res.json()) as {
      candidates?: { content?: { parts?: { inlineData?: { data?: string; mimeType?: string } }[] } }[];
    };
    const part = json.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data);
    const b64 = part?.inlineData?.data;
    if (!b64) return null;
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return {
      bytes,
      contentType: part?.inlineData?.mimeType ?? "image/png",
      url: `data:${part?.inlineData?.mimeType ?? "image/png"};base64,${b64}`,
    };
  } catch (error) {
    console.error("[nour] gemini image failed:", error);
    return null;
  }
}

/**
 * وصف بصري احترافي للصورة الرئيسية من عنوان المقال — بلا نص داخل الصورة
 * (النماذج ترسم حروفاً عربية مشوّهة، فنمنع الكتابة صراحةً).
 */
export function heroPrompt(topic: string, industry?: string): string {
  return [
    `Editorial hero photograph for an article about: ${topic}.`,
    industry ? `Brand industry: ${industry}.` : "",
    "Modern, clean, high-end commercial photography, soft natural light, shallow depth of field,",
    "Middle Eastern / Gulf context where relevant, realistic, 16:9, no text, no letters, no watermark, no logo.",
  ]
    .filter(Boolean)
    .join(" ");
}

/**
 * صورة رئيسية «مملوكة»: نولّدها ثم نرفعها إلى مخزن Supabase (nour-media) باسم مساحة العمل،
 * فتصبح أصلاً دائماً يخصّ العميل لا رابطاً خارجياً. عند أي فشل نرجع لرابط المزوّد المجاني.
 */
export async function ownedHeroImage(
  client: { storage: { from: (b: string) => { upload: (p: string, f: Blob, o?: Record<string, unknown>) => Promise<{ error: unknown }>; createSignedUrl: (p: string, s: number) => Promise<{ data: { signedUrl: string } | null }> } } },
  workspaceId: string,
  prompt: string,
): Promise<string> {
  const fallback = imageUrl(prompt);
  try {
    const image = await generateImageBytes(prompt);
    if (!image) return fallback;
    const ext = image.contentType.includes("png") ? "png" : "jpg";
    const path = `${workspaceId}/hero/${crypto.randomUUID()}.${ext}`;
    const bucket = client.storage.from("nour-media");
    const { error } = await bucket.upload(path, new Blob([image.bytes as BlobPart], { type: image.contentType }), {
      contentType: image.contentType,
      upsert: false,
    });
    if (error) return fallback;
    // رابط موقّع طويل الأمد (5 سنوات) صالح للنشر داخل المقال
    const { data } = await bucket.createSignedUrl(path, 60 * 60 * 24 * 365 * 5);
    return data?.signedUrl ?? fallback;
  } catch (error) {
    console.error("[nour] owned hero image failed:", error);
    return fallback;
  }
}
