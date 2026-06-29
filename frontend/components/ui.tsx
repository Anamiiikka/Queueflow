import type { JobStatus } from "@/lib/types";

const STATUS_STYLES: Record<string, string> = {
  pending: "bg-sky-400/15 text-sky-300 ring-1 ring-inset ring-sky-400/25",
  processing: "bg-amber-400/15 text-amber-300 ring-1 ring-inset ring-amber-400/30",
  completed: "bg-emerald-400/15 text-emerald-300 ring-1 ring-inset ring-emerald-400/25",
  retrying: "bg-orange-400/15 text-orange-300 ring-1 ring-inset ring-orange-400/25",
  failed: "bg-orange-400/15 text-orange-300 ring-1 ring-inset ring-orange-400/25",
  dead: "bg-rose-400/15 text-rose-300 ring-1 ring-inset ring-rose-400/30",
  cancelled: "bg-zinc-400/15 text-zinc-400 ring-1 ring-inset ring-zinc-400/20",
};

const DOT: Record<string, string> = {
  pending: "bg-sky-400",
  processing: "bg-amber-400 animate-pulse shadow-[0_0_8px] shadow-amber-400",
  completed: "bg-emerald-400",
  retrying: "bg-orange-400",
  failed: "bg-orange-400",
  dead: "bg-rose-400",
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

const ACCENTS: Record<
  string,
  { num: string; glow: string; bar: string; orb: string }
> = {
  sky: {
    num: "text-sky-300",
    glow: "drop-shadow-[0_0_16px_rgba(56,189,248,0.5)]",
    bar: "from-sky-400",
    orb: "bg-sky-500/30",
  },
  amber: {
    num: "text-amber-300",
    glow: "drop-shadow-[0_0_16px_rgba(251,191,36,0.5)]",
    bar: "from-amber-400",
    orb: "bg-amber-500/30",
  },
  emerald: {
    num: "text-emerald-300",
    glow: "drop-shadow-[0_0_16px_rgba(52,211,153,0.5)]",
    bar: "from-emerald-400",
    orb: "bg-emerald-500/30",
  },
  rose: {
    num: "text-rose-300",
    glow: "drop-shadow-[0_0_16px_rgba(251,113,133,0.5)]",
    bar: "from-rose-400",
    orb: "bg-rose-500/30",
  },
  violet: {
    num: "text-violet-300",
    glow: "drop-shadow-[0_0_16px_rgba(167,139,250,0.5)]",
    bar: "from-violet-400",
    orb: "bg-violet-500/30",
  },
};

export function StatCard({
  label,
  value,
  accent = "violet",
}: {
  label: string;
  value: number | string;
  accent?: keyof typeof ACCENTS;
}) {
  const a = ACCENTS[accent] ?? ACCENTS.violet!;
  return (
    <div className="panel group relative overflow-hidden p-5 transition hover:border-white/20">
      <div className={`absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r ${a.bar} to-transparent`} />
      <div
        className={`pointer-events-none absolute -right-6 -top-8 h-24 w-24 rounded-full blur-3xl transition-opacity group-hover:opacity-90 ${a.orb} opacity-60`}
      />
      <div className="relative">
        <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
          {label}
        </div>
        <div className={`mt-2 font-display text-[2.7rem] font-bold leading-none tabular-nums ${a.num} ${a.glow}`}>
          {value}
        </div>
      </div>
    </div>
  );
}

/** Inline-SVG area sparkline with a gradient fill. */
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
      <defs>
        <linearGradient id="spark" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="rgba(167,139,250,0.5)" />
          <stop offset="100%" stopColor="rgba(167,139,250,0)" />
        </linearGradient>
      </defs>
      <polygon points={area} fill="url(#spark)" />
      <polyline
        points={line}
        fill="none"
        stroke="rgb(192,132,252)"
        strokeWidth="1.5"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
