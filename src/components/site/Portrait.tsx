import { useRegion } from "@/hooks/use-region";
import { portraitOf, REGIONS, REGION_FLAGS, REGION_LABELS } from "@/data/team-portraits";
import { cn } from "@/lib/utils";

type PortraitProps = {
  memberId: string;
  name: string;
  className?: string;
  eager?: boolean;
};

/** صورة الموظف بالزي المناسب لبلد الزائر. */
export function Portrait({ memberId, name, className, eager }: PortraitProps) {
  const { region } = useRegion();
  return (
    <img
      key={`${memberId}-${region}`}
      src={portraitOf(memberId, region)}
      alt={`${name} — موظف رقمي في سهل`}
      width={768}
      height={768}
      loading={eager ? "eager" : "lazy"}
      className={cn(
        "animate-[ticker-up_0.45s_var(--ease-enter)] object-cover object-top",
        className,
      )}
    />
  );
}

/** مبدّل الزي الإقليمي — يظهر للزائر ليختار بلده بنفسه. */
export function RegionPicker({ className }: { className?: string }) {
  const { region, setRegion } = useRegion();
  return (
    <div
      className={cn(
        "inline-flex flex-wrap items-center gap-1 rounded-full border border-border bg-card/70 p-1 backdrop-blur",
        className,
      )}
      role="group"
      aria-label="اختر زي الفريق حسب بلدك"
    >
      {REGIONS.map((r) => (
        <button
          key={r}
          type="button"
          onClick={() => setRegion(r)}
          aria-pressed={region === r}
          className={cn(
            "rounded-full px-3.5 py-1.5 text-sm font-bold transition-all duration-300",
            region === r
              ? "bg-primary text-primary-foreground shadow-card"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          <span className="ml-1.5">{REGION_FLAGS[r]}</span>
          {REGION_LABELS[r]}
        </button>
      ))}
    </div>
  );
}
