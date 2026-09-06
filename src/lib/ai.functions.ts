import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { freeChat } from "@/lib/nour-research.server";
import { actionTruthRules, sanitizeActionClaims } from "@/lib/action-claims";
import {
  craft,
  evidenceRules,
  executeSkill,
  personas,
  researchFor,
} from "@/lib/nour-run.server";
import { employeeDirectory, sharedSystemBlocks, type EmployeeId } from "@/lib/team-knowledge";


type Deliverable = {
  title?: string;
  kind?: string;
  channel?: string;
  body?: string;
  scheduled?: string;
  image_prompt?: string | null;
};

type NeedsConnection = { provider: string; reason: string } | null;

const input = z.object({
  workspaceId: z.string().uuid(),
  employeeId: z.string().min(1),
  message: z.string().min(1).max(4000),
});

/** الموظفون الذين تُولَّد لهم صورة فعلية عند وجود وصف بصري في الرد. */
const VISUAL_EMPLOYEES = new Set(["dana", "sonny", "nour"]);

export const askEmployee = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => input.parse(data))
  .handler(async ({ data, context }) => {
    // المفاتيح تُقرأ داخل freeChat من جدول app_secrets في Supabase.
    const apiKey = "";


    const supabase = context.supabase;
    const persona = personas[data.employeeId];
    if (!persona) throw new Error("موظف غير معروف.");

    const [{ data: workspace }, { data: brain }, { data: history }, { data: linked }, { data: direct }, { data: recentTasks }] =
      await Promise.all([
        supabase.from("workspaces").select("*").eq("id", data.workspaceId).maybeSingle(),
        supabase.from("brain_items").select("title, body, kind").eq("workspace_id", data.workspaceId),
        supabase
          .from("messages")
          .select("role, body")
          .eq("workspace_id", data.workspaceId)
          .eq("employee_id", data.employeeId)
          .order("created_at", { ascending: false })
          .limit(12),
        supabase
          .from("pipedream_accounts")
          .select("provider")
          .eq("workspace_id", data.workspaceId)
          .eq("status", "connected"),
        supabase
          .from("integrations")
          .select("provider")
          .eq("workspace_id", data.workspaceId)
          .eq("status", "connected"),
        // ما أنجزه الزملاء مؤخراً — حتى يعرف كل موظف ما يجري في الفريق.
        supabase
          .from("tasks")
          .select("employee_id, title, status, created_at")
          .eq("workspace_id", data.workspaceId)
          .order("created_at", { ascending: false })
          .limit(8),
      ]);

    // حالة الربط الحقيقية تُحقن في التعليمات حتى لا يدّعي الموظف نشراً مستحيلاً.
    const connected = [
      ...new Set([...(linked ?? []).map((a) => a.provider), ...(direct ?? []).map((i) => i.provider)]),
    ];

    if (!workspace) throw new Error("مساحة العمل غير موجودة.");
    const ws = workspace as typeof workspace & {
      profile?: unknown;
      website?: string | null;
      country?: string | null;
    };

    const { error: insertUserError } = await supabase.from("messages").insert({
      workspace_id: data.workspaceId,
      employee_id: data.employeeId,
      role: "user",
      body: data.message,
    });
    if (insertUserError) throw new Error(insertUserError.message);

    const { memoryBlock } = await import("./memory.server");
    const brainText = memoryBlock(brain ?? [], data.message, 8);

    const longForm =
      /مقال|خطة\s*(سيو|محتوى|تسويق)|\d{3,4}\s*كلمة|صفحة هبوط|دليل شامل|حملة كاملة/.test(data.message) ||
      data.message.length > 220;

    const research = await researchFor(
      data.employeeId,
      apiKey,
      { name: workspace.name, industry: workspace.industry },
      data.message,
      data.workspaceId,
      // الطلبات الكبيرة تستحق أدلة أكمل (مقاييس + نتائج بحث + موجز منافسين).
      longForm ? 22_000 : 12_000,
    );

    // المنصة التي سمّاها المستخدم بنفسه — تُحترم حرفياً ولا تُبدَّل بغيرها.
    const { requestedPublishTargets, providerLabel } = await import("./platforms");
    const askedTargets = requestedPublishTargets(data.message);
    const askedBlock = askedTargets.length
      ? `## المنصة التي طلبها المستخدم صراحةً\nالمستخدم طلب: ${askedTargets.map((p) => `${providerLabel(p)} (${p})`).join("، ")}. ` +
        `اجعل "channel" في المخرج هو "${askedTargets[0]}" حرفياً، وكيّف النص لقواعد هذه المنصة (الطول، النبرة، الهاشتاقات). ` +
        `لا تقترح منصة أخرى بدلاً منها. ` +
        (askedTargets.some((p) => !connected.includes(p))
          ? `تنبيه: ${askedTargets.filter((p) => !connected.includes(p)).map(providerLabel).join(" و")} غير مربوط بعد — أنجز المخرج كاملاً، وضع في needs_connection المنصة "${askedTargets.find((p) => !connected.includes(p))}" بسبب قصير.`
          : `هذه المنصة مربوطة — أنجز المخرج جاهزاً للنشر عليها مباشرة.`)
      : "";

    // تنفيذ فعلي لقدرات الأقسام من داخل الشات (فحص سيو، ترتيب، تقويم، أفكار، أداء).
    let toolBlocks: { block: string; footer: string; tool: string }[] = [];
    try {
      const { runChatTools } = await import("./chat-tools.server");
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      toolBlocks = await runChatTools(supabaseAdmin, {
        workspaceId: data.workspaceId,
        employeeId: data.employeeId,
        message: data.message,
        website: ws.website,
        country: ws.country,
        connected,
        targets: askedTargets,
      });
    } catch (e) {
      console.warn("[chat-tools] skipped:", e instanceof Error ? e.message : e);
    }
    const toolsBlock = toolBlocks.length
      ? `## نتائج نفّذتها فعلاً الآن من أقسام المنصة (حقيقية — استخدمها حرفياً)\n${toolBlocks.map((t) => t.block).join("\n\n")}`
      : "";

    const teamActivity = (recentTasks ?? [])
      .map((t) => {
        const who = employeeDirectory[t.employee_id as EmployeeId]?.name ?? t.employee_id;
        return `- ${who}: ${t.title} (${t.status === "done" ? "منشور/منجز" : t.status === "review" ? "بانتظار الاعتماد" : t.status})`;
      })
      .join("\n");

    const today = new Date();
    const todayAr = today.toLocaleDateString("ar-EG", {
      timeZone: "Africa/Cairo",
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });

    const system = [
      `أنت ${persona.name}، ${persona.role}`,
      `تعمل داخل منصة «سهل» لصالح العلامة: ${workspace.name} (${workspace.industry}).`,
      `نبرة العلامة: ${workspace.tone}.`,
      `تاريخ اليوم: ${todayAr} (${today.toISOString().slice(0, 10)}).`,
      workspace.banned_words?.length
        ? `كلمات ممنوعة تماماً: ${workspace.banned_words.join("، ")}.`
        : "",
      craft[data.employeeId] ? `## معايير حِرفتك\n${craft[data.employeeId]}` : "",
      ...sharedSystemBlocks({
        employeeId: data.employeeId,
        connected,
        profile: ws.profile,
        website: ws.website,
        country: ws.country,
      }),
      brainText ? `## عقل العلامة (ذاكرة مشتركة بين الفريق)\n${brainText}` : "",
      teamActivity ? `## آخر ما أنجزه الفريق\n${teamActivity}` : "",
      research.block ? `${evidenceRules}\n\n## أدلة ميدانية (لحظية)\n${research.block}` : "",
      actionTruthRules,
      askedBlock,
      toolsBlock,
      "## أسلوب المحادثة",
      "أجب دائماً بالعربية. التحية والأسئلة القصيرة: رد قصير ودافئ بجملة أو اثنتين ثم اقتراح عملي واحد. طلبات العمل: مخرج كامل جاهز مباشرة.",
      "إن كان طلب المستخدم يحتاج صورة (تصميم، منشور بصري، صورة مقال، كرييتف) فاكتب وصفاً بصرياً إنجليزياً دقيقاً في الحقل image_prompt — وستُولَّد الصورة فعلياً وتُعرض للمستخدم؛ لا تكتفِ بوصفها في النص.",
      'أعد ردك بصيغة JSON فقط بالشكل: {"reply": "نص ردك للمستخدم بصيغة Markdown", "deliverable": {"title": "عنوان المخرج", "kind": "نوع المخرج", "channel": "المنصة", "body": "نص المخرج الجاهز", "scheduled": "متى يُنفّذ", "image_prompt": "English visual prompt or null"} , "needs_connection": {"provider": "معرّف المنصة مثل instagram أو wordpress أو search-console", "reason": "سبب من 8 كلمات مرتبط بهذه المهمة"} }',
      'إن لم يطلب المستخدم مخرجاً جاهزاً للنشر أو الإرسال، اجعل "deliverable" القيمة null. واجعل "needs_connection" القيمة null إلا إذا كانت هذه المهمة تحديداً تحتاج حساباً غير مربوط لتنفيذها فعلياً (نشر/إرسال/قراءة بيانات حقيقية).',
      `المنصة الافتراضية لك هي ${persona.channel} ونوع مخرجك الشائع ${persona.kind}.`,
    ]
      .filter(Boolean)
      .join("\n");

    const priorMessages = (history ?? [])
      .slice()
      .reverse()
      .map((m) => ({ role: m.role === "user" ? "user" : "assistant", content: m.body }));

    const raw = await freeChat(
      apiKey,
      [
        { role: "system", content: system },
        ...priorMessages,
        { role: "user", content: data.message },
      ],
      // طلبات المقالات/الخطط الكاملة تحتاج مخرجاً طويلاً ومهلة أطول — مع سقف زمني إجمالي حتى لا يعلّق الشات.
      longForm
        ? { json: true, timeoutMs: 75_000, maxTokens: 6000, budgetMs: 130_000 }
        : { json: true, timeoutMs: 40_000, maxTokens: 1800, budgetMs: 100_000 },
    );

    let reply = raw;
    let deliverables: Deliverable[] = [];
    let needsConnection: NeedsConnection = null;

    try {
      const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
      const parsed: unknown = JSON.parse(cleaned);
      // النموذج قد يعيد كائناً واحداً أو مصفوفة كائنات — نتعامل مع الحالتين.
      const items = (Array.isArray(parsed) ? parsed : [parsed]).filter(
        (x): x is { reply?: string; deliverable?: Deliverable | null; needs_connection?: NeedsConnection } =>
          Boolean(x) && typeof x === "object",
      );
      const replies = items.map((x) => (typeof x.reply === "string" ? x.reply.trim() : "")).filter(Boolean);
      deliverables = items
        .map((x) => x.deliverable)
        .filter((d): d is Deliverable => Boolean(d?.title && d.body))
        .map((d) => (askedTargets[0] ? { ...d, channel: askedTargets[0] } : d));
      const nc = items.map((x) => x.needs_connection).find((n) => n && typeof n === "object" && typeof n.provider === "string");
      // لا نعرض زر ربط لحساب مربوط فعلاً أو لمنصة لا تخص هذا الموظف.
      if (nc && !connected.includes(nc.provider)) {
        const allowed = employeeDirectory[data.employeeId as EmployeeId]?.integrations.some((i) => i.provider === nc.provider);
        if (allowed) needsConnection = { provider: nc.provider, reason: String(nc.reason ?? "").slice(0, 160) };
      }
      // إن طلب المستخدم منصة غير مربوطة ولم يذكرها النموذج، نطلب ربطها نحن.
      const askedMissing = askedTargets.find((p) => !connected.includes(p));
      if (!needsConnection && askedMissing && deliverables.length) {
        needsConnection = { provider: askedMissing, reason: `طلبت النشر على ${providerLabel(askedMissing)}` };
      }
      if (replies.length) {
        reply = replies.join("\n\n");
      } else if (deliverables.length) {
        reply = deliverables
          .map((d) => `### ${d.title}\n\n${d.body}`)
          .join("\n\n---\n\n");
      }
    } catch {
      deliverables = [];
      // JSON مقطوع (ردّ طويل): ننقذ نص reply بدل عرض JSON خام للمستخدم.
      const m = raw.match(/"reply"\s*:\s*"((?:[^"\\]|\\.)*)/);
      if (m?.[1]) {
        try {
          reply = JSON.parse(`"${m[1]}"`);
        } catch {
          reply = m[1].replace(/\\n/g, "\n").replace(/\\"/g, '"');
        }
      }
    }

    // الصور تُولَّد فعلياً — لا يبقى المستخدم مع «برومبت» مكتوب فقط.
    let imageUrl: string | null = null;
    if (VISUAL_EMPLOYEES.has(data.employeeId)) {
      try {
        const { ownedHeroImage, extractImagePrompt, imageBrief } = await import("./image-gen.server");
        const fromField = deliverables.map((d) => d.image_prompt).find((p) => typeof p === "string" && p.trim().length > 30);
        const draft =
          (fromField ? fromField.trim() : null) ??
          extractImagePrompt(`${reply}\n${deliverables.map((d) => d.body ?? "").join("\n")}`);
        const wantsVisual = Boolean(draft) || deliverables.some((d) => d.body && d.body.length > 80);
        if (wantsVisual) {
          // «مخرج صور»: الوصف يُشتق من طلب المستخدم نفسه ومن المخرج، حتى تعكس الصورة الموضوع فعلاً.
          const prompt = await imageBrief({
            request: data.message,
            title: deliverables[0]?.title ?? null,
            body: deliverables[0]?.body ?? reply,
            brand: { name: workspace?.name, industry: workspace?.industry, country: workspace?.country ?? null },
            draft,
          });
          imageUrl = await ownedHeroImage(
            supabase as unknown as Parameters<typeof ownedHeroImage>[0],
            data.workspaceId,
            prompt,
          );
        }
      } catch (error) {
        console.error("[chat] image generation failed:", error);
      }
    }


    reply = sanitizeActionClaims(reply, connected);
    const footers = toolBlocks.map((t) => t.footer).filter(Boolean);
    if (footers.length) reply = `${reply.trim()}\n\n> ${footers.join(" · ")}`;

    if (imageUrl) {
      const alt = (deliverables[0]?.title ?? "الصورة المولّدة").slice(0, 120);
      reply = `${reply.trim()}\n\n![${alt}](${imageUrl})`;
    }

    if (research.used.length) {
      reply = `${reply.trim()}\n\n— استندتُ إلى بيانات حقيقية: ${research.used.join(" · ")}`;
    }

    const { data: assistantRow, error: assistantError } = await supabase
      .from("messages")
      .insert({
        workspace_id: data.workspaceId,
        employee_id: data.employeeId,
        role: "assistant",
        body: reply,
      })
      .select()
      .single();
    if (assistantError) throw new Error(assistantError.message);

    let createdTaskId: string | null = null;
    for (const deliverable of deliverables) {
      const output = imageUrl ? `![${deliverable.title}](${imageUrl})\n\n${deliverable.body!}` : deliverable.body!;
      const { data: task } = await supabase
        .from("tasks")
        .insert({
          workspace_id: data.workspaceId,
          employee_id: data.employeeId,
          title: deliverable.title!,
          detail: reply.slice(0, 400),
          kind: deliverable.kind ?? persona.kind,
          channel: deliverable.channel ?? persona.channel,
          status: "review",
          output,
          scheduled: deliverable.scheduled ?? "بانتظار اعتمادك",
          steps: [
            { label: "فهم الطلب", state: "done" },
            { label: "التنفيذ", state: "done" },
            { label: "مراجعتك", state: "active" },
            { label: "النشر", state: "todo" },
          ],
        })
        .select("id")
        .single();
      createdTaskId = createdTaskId ?? task?.id ?? null;
    }


    return { reply, messageId: assistantRow.id, createdTaskId, needsConnection, imageUrl };
  });

const skillInput = z.object({
  workspaceId: z.string().uuid(),
  employeeId: z.string().min(1),
  skillId: z.string().min(1),
  values: z.record(z.string(), z.string()),
});

/** تشغيل قدرة محددة: يخرج مخرجاً جاهزاً ويحفظه كمهمة بانتظار الاعتماد. */
export const runSkill = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => skillInput.parse(data))
  .handler(async ({ data, context }) => {
    const run = await executeSkill(context.supabase, {
      workspaceId: data.workspaceId,
      employeeId: data.employeeId,
      skillId: data.skillId,
      values: data.values,
    });
    return { output: run.output, messageId: run.messageId, taskId: run.taskId };
  });

