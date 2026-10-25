import type { LucideIcon } from "lucide-react";

type MetricCardProps = {
  label: string;
  value: string | number;
  hint: string;
  icon: LucideIcon;
  tone?: "blue" | "violet" | "green" | "orange";
};

const tones = {
  blue: "bg-blue-500/10 text-blue-500",
  violet: "bg-violet-500/10 text-violet-500",
  green: "bg-emerald-500/10 text-emerald-500",
  orange: "bg-orange-500/10 text-orange-500",
};

export function MetricCard({
  label,
  value,
  hint,
  icon: Icon,
  tone = "blue",
}: MetricCardProps) {
  return (
    <article className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-4 shadow-[var(--card-shadow)] transition hover:-translate-y-px hover:border-[var(--line-strong)]">
      <div className="mb-3 flex items-start justify-between">
        <span className="text-[11px] font-medium text-[var(--muted)]">{label}</span>
        <span className={`grid size-7 place-items-center rounded-lg ${tones[tone]}`}>
          <Icon className="size-3.5" strokeWidth={2} />
        </span>
      </div>
      <div className="text-[25px] font-semibold tracking-[-0.04em]">{value}</div>
      <p className="mt-1 text-[10px] text-[var(--muted)]">{hint}</p>
    </article>
  );
}
