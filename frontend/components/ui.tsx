import type { JobStatus } from "@/lib/types";

const TONE: Record<string, string> = {
  pending: "text-muted",
  processing: "text-gold",
  completed: "text-sage",
  retrying: "text-gold",
  failed: "text-gold",
  dead: "text-rust",
  cancelled: "text-muted",
};
const DOT: Record<string, string> = {
  pending: "bg-muted",
  processing: "bg-gold animate-pulse",
  completed: "bg-sage",
  retrying: "bg-gold",
  failed: "bg-gold",
  dead: "bg-rust",
  cancelled: "bg-muted/60",
};

export function StatusBadge({ status }: { status: JobStatus | string }) {
  return (
    <span className={`chip ${TONE[status] ?? "text-ink"}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${DOT[status] ?? "bg-white/50"}`} />
      {status}
    </span>
  );
}

const NUM_TONE: Record<string, string> = {
  ink: "text-ink",
  gold: "text-gold",
  sage: "text-sage",
  rust: "text-rust",
};

export interface Stat {
  label: string;
  value: number | string;
  unit?: string;
  tone?: keyof typeof NUM_TONE;
  spark?: number[];
}

/** Editorial stat strip — cells divided by hairlines, big flat serif numbers. */
export function StatStrip({ items }: { items: Stat[] }) {
  return (
    <div className="panel grid grid-cols-2 divide-x divide-y divide-white/[0.08] sm:grid-cols-3 sm:divide-y-0 lg:grid-cols-5">
      {items.map((it) => (
        <div key={it.label} className="px-5 py-5">
          <div className="label">{it.label}</div>
          <div className="mt-2 flex items-baseline gap-1.5">
            <span className={`font-serif text-[2.4rem] font-semibold leading-none tabular-nums ${NUM_TONE[it.tone ?? "ink"]}`}>
              {it.value}
            </span>
            {it.unit && <span className="font-mono text-[11px] text-muted">{it.unit}</span>}
          </div>
          {it.spark ? (
            <Sparkline data={it.spark} className="mt-2.5 h-5 w-full" />
          ) : (
            <div className="mt-3 h-px w-7 bg-white/15" />
          )}
        </div>
      ))}
    </div>
  );
}

/** Flat single-stroke sparkline in the gold accent. */
export function Sparkline({ data, className = "" }: { data: number[]; className?: string }) {
  const w = 100;
  const h = 24;
  const max = Math.max(1, ...data);
  const step = data.length > 1 ? w / (data.length - 1) : w;
  const line = data
    .map((v, i) => `${(i * step).toFixed(1)},${(h - (v / max) * (h - 2) - 1).toFixed(1)}`)
    .join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className={className}>
      <polyline
        points={line}
        fill="none"
        stroke="#d6a35c"
        strokeWidth="1.25"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
