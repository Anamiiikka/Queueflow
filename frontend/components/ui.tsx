import type { JobStatus } from "@/lib/types";

const STATUS_STYLES: Record<string, string> = {
  pending: "bg-slate-500/20 text-slate-300",
  processing: "bg-blue-500/20 text-blue-300 animate-pulse",
  completed: "bg-emerald-500/20 text-emerald-300",
  retrying: "bg-amber-500/20 text-amber-300",
  failed: "bg-amber-500/20 text-amber-300",
  dead: "bg-red-500/20 text-red-300",
  cancelled: "bg-zinc-500/20 text-zinc-400",
};

export function StatusBadge({ status }: { status: JobStatus | string }) {
  const cls = STATUS_STYLES[status] ?? "bg-white/10 text-ink";
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>
      {status}
    </span>
  );
}

export function StatCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: number | string;
  accent?: string;
}) {
  return (
    <div className="panel p-4">
      <div className="text-xs uppercase tracking-wide text-muted">{label}</div>
      <div className={`mt-1 text-3xl font-semibold ${accent ?? "text-ink"}`}>{value}</div>
    </div>
  );
}
