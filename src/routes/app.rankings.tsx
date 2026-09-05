import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Plus, RefreshCw, Trash2, TrendingDown, TrendingUp } from "lucide-react";

import { AppShell } from "@/components/app/AppShell";
import { useWorkspace } from "@/lib/data";
import {
  addTrackedKeyword,
  listTrackedKeywords,
  refreshRankings,
  removeTrackedKeyword,
} from "@/lib/rank-tracker.functions";

export const Route = createFileRoute("/app/rankings")({
  head: () => ({
    meta: [
      { title: "تتبّع الترتيب | سهل" },
      {
        name: "description",
        content: "لوحة تاريخية لترتيب كلماتك المفتاحية في نتائج البحث الحية — أرقام حقيقية بلا تقدير.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: RankingsPage,
});

type Point = { position: number | null; url: string | null; capturedAt: string };

/** خط اتجاه صغير: الأعلى في الرسم = ترتيب أفضل (رقم أصغر). */
function Sparkline({ points }: { points: Point[] }) {
  const values = points.filter((p) => p.position != null).slice(-14);
  if (values.length < 2) return <span className="text-xs text-muted-foreground">—</span>;
  const w = 120;
  const h = 32;
  const max = Math.max(...values.map((p) => p.position!), 10);
  const path = values
    .map((p, i) => {
      const x = (i / (values.length - 1)) * w;
      const y = ((p.position! - 1) / Math.max(max - 1, 1)) * (h - 4) + 2;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg width={w} height={h} className="text-jade" aria-hidden>
      <path d={path} fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
    </svg>
  );
}

function Delta({ points }: { points: Point[] }) {
  const values = points.filter((p) => p.position != null);
  if (values.length < 2) return null;
  const first = values[values.length - 2]!.position!;
  const last = values[values.length - 1]!.position!;
  const diff = first - last; // موجب = تحسّن
  if (diff === 0) return <span className="text-xs text-muted-foreground">ثابت</span>;
  const up = diff > 0;
  return (
    <span
      className={`inline-flex items-center gap-1 text-xs font-bold ${up ? "text-jade" : "text-coral"}`}
    >
      {up ? <TrendingUp className="size-3.5" /> : <TrendingDown className="size-3.5" />}
      {Math.abs(diff)}
    </span>
  );
}

function RankingsPage() {
  const { data: workspace } = useWorkspace();
  const qc = useQueryClient();
  const list = useServerFn(listTrackedKeywords);
  const add = useServerFn(addTrackedKeyword);
  const remove = useServerFn(removeTrackedKeyword);
  const refresh = useServerFn(refreshRankings);

  const [keyword, setKeyword] = useState("");
  const [domain, setDomain] = useState("");

  const key = ["rankings", workspace?.id];
  const { data, isLoading } = useQuery({
    queryKey: key,
    enabled: Boolean(workspace?.id),
    queryFn: () => list({ data: { workspaceId: workspace!.id } }),
  });

  const invalidate = () => void qc.invalidateQueries({ queryKey: key });

  const addMutation = useMutation({
    mutationFn: () =>
      add({ data: { workspaceId: workspace!.id, keyword, domain, market: "SA" } }),
    onSuccess: () => {
      setKeyword("");
      invalidate();
    },
  });

  const refreshMutation = useMutation({
    mutationFn: () => refresh({ data: { workspaceId: workspace!.id } }),
    onSuccess: invalidate,
  });

  const removeMutation = useMutation({
    mutationFn: (id: string) => remove({ data: { workspaceId: workspace!.id, id } }),
    onSuccess: invalidate,
  });

  const rows = data?.keywords ?? [];

  return (
    <AppShell
      title="تتبّع الترتيب"
      lead="ترتيبك الحقيقي في نتائج البحث لكل كلمة — لقطة بتاريخها لترى الاتجاه"
      actions={
        <button
          onClick={() => refreshMutation.mutate()}
          disabled={!workspace || refreshMutation.isPending || !rows.length}
          className="inline-flex items-center gap-1.5 rounded-xl bg-foreground px-3.5 py-2.5 text-sm font-bold text-background disabled:opacity-50"
        >
          {refreshMutation.isPending ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <RefreshCw className="size-4" />
          )}
          حدّث الترتيب الآن
        </button>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (keyword.trim().length > 1 && domain.trim().length > 2) addMutation.mutate();
        }}
        className="flex flex-wrap items-end gap-3 rounded-2xl border border-border bg-card p-4"
      >
        <label className="min-w-48 flex-1">
          <span className="mb-1 block text-xs font-bold text-muted-foreground">الكلمة المفتاحية</span>
          <input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="مثال: أفضل قهوة مختصة بالرياض"
            className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm"
          />
        </label>
        <label className="min-w-40 flex-1">
          <span className="mb-1 block text-xs font-bold text-muted-foreground">نطاق موقعك</span>
          <input
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
            placeholder="example.com"
            dir="ltr"
            className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm"
          />
        </label>
        <button
          type="submit"
          disabled={addMutation.isPending}
          className="inline-flex items-center gap-1.5 rounded-xl bg-jade px-3.5 py-2.5 text-sm font-bold text-background disabled:opacity-50"
        >
          <Plus className="size-4" /> تتبّع
        </button>
      </form>

      {isLoading ? (
        <p className="mt-6 flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> جارٍ تحميل الكلمات…
        </p>
      ) : rows.length === 0 ? (
        <p className="mt-6 rounded-2xl border border-dashed border-border p-6 text-sm text-muted-foreground">
          أضف كلماتك المهمة ونطاق موقعك، ثم اضغط «حدّث الترتيب الآن» — نور تلتقط ترتيبك من نتائج بحث
          حقيقية وتحفظ لك السجل يوماً بيوم.
        </p>
      ) : (
        <div className="mt-6 overflow-x-auto rounded-2xl border border-border">
          <table className="w-full text-start text-sm">
            <thead className="bg-secondary/60 text-xs">
              <tr>
                <th className="p-3 text-start font-bold">الكلمة</th>
                <th className="p-3 text-start font-bold">النطاق</th>
                <th className="p-3 text-start font-bold">الترتيب الحالي</th>
                <th className="p-3 text-start font-bold">التغيّر</th>
                <th className="p-3 text-start font-bold">الاتجاه</th>
                <th className="p-3 text-start font-bold">آخر فحص</th>
                <th className="p-3" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const points = data?.history?.[row.id] ?? [];
                const last = [...points].reverse().find((p) => p.position != null);
                return (
                  <tr key={row.id} className="border-t border-border/70">
                    <td className="max-w-[18rem] truncate p-3 font-semibold">{row.keyword}</td>
                    <td className="p-3 text-muted-foreground" dir="ltr">
                      {row.domain}
                    </td>
                    <td className="p-3 font-black">
                      {last?.position ? `#${last.position}` : "خارج أول 10"}
                    </td>
                    <td className="p-3">
                      <Delta points={points} />
                    </td>
                    <td className="p-3">
                      <Sparkline points={points} />
                    </td>
                    <td className="p-3 text-xs text-muted-foreground">
                      {row.last_checked_at
                        ? new Date(row.last_checked_at).toLocaleDateString("ar-EG")
                        : "—"}
                    </td>
                    <td className="p-3">
                      <button
                        onClick={() => removeMutation.mutate(row.id)}
                        className="rounded-lg p-2 text-muted-foreground hover:text-coral"
                        aria-label="حذف الكلمة"
                      >
                        <Trash2 className="size-4" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </AppShell>
  );
}
