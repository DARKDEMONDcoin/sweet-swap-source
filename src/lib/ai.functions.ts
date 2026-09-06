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

    const research = await researchFor(
      data.employeeId,
      apiKey,
      { name: workspace.name, industry: workspace.industry },
      data.message,
      data.workspaceId,
      12_000,
    );

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
      { json: true, timeoutMs: 40_000, maxTokens: 1800 },
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
        .filter((d): d is Deliverable => Boolean(d?.title && d.body));
      const nc = items.map((x) => x.needs_connection).find((n) => n && typeof n === "object" && typeof n.provider === "string");
      // لا نعرض زر ربط لحساب مربوط فعلاً أو لمنصة لا تخص هذا الموظف.
      if (nc && !connected.includes(nc.provider)) {
        const allowed = employeeDirectory[data.employeeId as EmployeeId]?.integrations.some((i) => i.provider === nc.provider);
        if (allowed) needsConnection = { provider: nc.provider, reason: String(nc.reason ?? "").slice(0, 160) };
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
    }

    // الصور تُولَّد فعلياً — لا يبقى المستخدم مع «برومبت» مكتوب فقط.
    let imageUrl: string | null = null;
    if (VISUAL_EMPLOYEES.has(data.employeeId)) {
      try {
        const { ownedHeroImage, extractImagePrompt } = await import("./image-gen.server");
        const fromField = deliverables.map((d) => d.image_prompt).find((p) => typeof p === "string" && p.trim().length > 30);
        const prompt =
          (fromField ? `${fromField.trim()} No text, no letters, no watermark, no logo.` : null) ??
          extractImagePrompt(`${reply}\n${deliverables.map((d) => d.body ?? "").join("\n")}`);
        if (prompt) {
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

