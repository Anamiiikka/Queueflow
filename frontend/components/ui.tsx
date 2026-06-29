import type { JobStatus } from "@/lib/types";

const STATUS_STYLES: Record<string, string> = {
  pending: "bg-slate-400/15 text-slate-300",
  processing: "bg-blue-400/15 text-blue-300",
  completed: "bg-emerald-400/15 text-emerald-300",
  retrying: "bg-amber-400/15 text-amber-300",
  failed: "bg-amber-400/15 text-amber-300",
  dead: "bg-red-400/15 text-red-300",
  cancelled: "bg-zinc-400/15 text-zinc-400",
};

const DOT: Record<string, string> = {
  pending: "bg-slate-400",
  processing: "bg-blue-400 animate-pulse",
  completed: "bg-emerald-400",
  retrying: "bg-amber-400",
  failed: "bg-amber-400",
  dead: "bg-red-400",
  cancelled: "bg-zinc-500",
};

export function StatusBadge({ status }: { status: JobStatus | string }) {
  return (
    <span className={`chip ${STATUS_STYLES[status] ?? "bg-white/10 text-ink"}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${DOT[status] ?? "bg-white/50"}`} />
      {status}
    </span>
  );
}

const ACCENTS: Record<string, { text: string; ring: string }> = {
  indigo: { text: "text-indigo-300", ring: "from-indigo-500/40" },
  blue: { text: "text-blue-300", ring: "from-blue-500/40" },
  emerald: { text: "text-emerald-300", ring: "from-emerald-500/40" },
  red: { text: "text-red-300", ring: "from-red-500/40" },
};

export function StatCard({
  label,
  value,
  accent = "indigo",
  hint,
}: {
  label: string;
  value: number | string;
  accent?: keyof typeof ACCENTS;
  hint?: string;
}) {
  const a = ACCENTS[accent] ?? ACCENTS.indigo!;
  return (
    <div className="panel relative overflow-hidden p-5 transition hover:border-white/15">
      <div className={`absolute inset-x-0 top-0 h-px bg-gradient-to-r ${a.ring} to-transparent`} />
      <div className="text-[11px] font-medium uppercase tracking-wider text-muted">{label}</div>
      <div className={`mt-2 text-4xl font-semibold tabular-nums ${a.text}`}>{value}</div>
      {hint && <div className="mt-1 text-xs text-muted">{hint}</div>}
    </div>
  );
}

/** Tiny inline-SVG area sparkline for the throughput series. */
export function Sparkline({ data, className = "" }: { data: number[]; className?: string }) {
  const w = 100;
  const h = 28;
  const max = Math.max(1, ...data);
  const step = data.length > 1 ? w / (data.length - 1) : w;
  const pts = data.map((v, i) => [i * step, h - (v / max) * (h - 2) - 1] as const);
  const line = pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = `0,${h} ${line} ${w},${h}`;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className={className}>
      <polygon points={area} fill="rgba(99,102,241,0.18)" />
      <polyline
        points={line}
        fill="none"
        stroke="rgb(129,140,248)"
        strokeWidth="1.5"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
