import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { SeoAudit } from "@/lib/seo-audit.server";

/** فحص سيو مجاني لأي صفحة: on-page + سرعة Lighthouse (إن توفرت). */
export const auditSite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z.object({ url: z.string().trim().min(4).max(300), withSpeed: z.boolean().default(true) }).parse(data),
  )
  .handler(async ({ data }): Promise<SeoAudit> => {
    const { auditPage, pageSpeed } = await import("./seo-audit.server");
    const audit = await auditPage(data.url);
    if (data.withSpeed) {
      // السرعة لا تُعطّل التقرير إن تأخر Lighthouse
      const speed = await Promise.race([
        pageSpeed(audit.finalUrl),
        new Promise<null>((r) => setTimeout(() => r(null), 30_000)),
      ]);
      return { ...audit, speed };
    }
    return audit;
  });
