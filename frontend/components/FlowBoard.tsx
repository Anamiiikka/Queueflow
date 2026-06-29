"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { FlowChip, FlowState } from "@/lib/useWebSocket";

const TYPE_COLOR: Record<string, string> = {
  email: "bg-indigo-500/20 text-indigo-200 border-indigo-400/30",
  image: "bg-emerald-500/20 text-emerald-200 border-emerald-400/30",
  pdf: "bg-amber-500/20 text-amber-200 border-amber-400/30",
  ai: "bg-violet-500/20 text-violet-200 border-violet-400/30",
};
const typeClass = (t: string) => TYPE_COLOR[t] ?? "bg-white/10 text-ink border-white/15";

function Chip({ chip, pulse }: { chip: FlowChip; pulse?: boolean }) {
  return (
    <span
      className={`flow-chip inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 font-mono text-[10px] ${typeClass(
        chip.type,
      )} ${pulse ? "shadow-[0_0_12px_-2px] shadow-blue-400/50" : ""}`}
      title={chip.id}
    >
      <span className={`h-1 w-1 rounded-full bg-current ${pulse ? "animate-pulse" : ""}`} />
      {chip.type}
    </span>
  );
}

function Column({
  title,
  chips,
  accent,
  pulse,
  empty,
}: {
  title: string;
  chips: FlowChip[];
  accent: string;
  pulse?: boolean;
  empty: string;
}) {
  return (
    <div className="flex min-h-[150px] flex-col rounded-xl border border-white/[0.06] bg-black/20">
      <div className="flex items-center justify-between border-b border-white/[0.06] px-3 py-2">
        <span className={`text-[11px] font-semibold uppercase tracking-wider ${accent}`}>{title}</span>
        <span className="rounded-full bg-white/5 px-2 py-0.5 text-[11px] tabular-nums text-muted">
          {chips.length}
        </span>
      </div>
      <div className="flex flex-1 flex-wrap content-start gap-1.5 overflow-hidden p-2.5">
        {chips.length === 0 ? (
          <span className="m-auto text-[11px] text-muted/60">{empty}</span>
        ) : (
          chips.map((c) => <Chip key={c.id} chip={c} pulse={pulse} />)
        )}
      </div>
    </div>
  );
}

export function FlowBoard({ flow }: { flow: FlowState }) {
  const qc = useQueryClient();
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["jobs"] });
    qc.invalidateQueries({ queryKey: ["stats"] });
    qc.invalidateQueries({ queryKey: ["dlq"] });
  };

  const burst = useMutation({
    mutationFn: async (n: number) => {
      const types = ["email", "image", "pdf", "ai"];
      await Promise.all(
        Array.from({ length: n }, (_, i) =>
          api.createJob({ type: types[i % types.length]!, priority: ((i % 5) + 1), payload: { burst: true } }),
        ),
      );
    },
    onSuccess: refresh,
  });
  const chaos = useMutation({ mutationFn: () => api.chaos(5), onSuccess: refresh });

  return (
    <div className="panel p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">Live job flow</h2>
          <p className="text-xs text-muted">
            Drive the queue and watch it react — then crash a worker and watch the engine recover.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button className="btn" onClick={() => burst.mutate(10)} disabled={burst.isPending}>
            Burst ×10
          </button>
          <button className="btn" onClick={() => burst.mutate(25)} disabled={burst.isPending}>
            Burst ×25
          </button>
          <button
            className="rounded-lg border border-red-400/30 bg-red-500/15 px-3 py-1.5 text-sm font-semibold text-red-200 transition hover:bg-red-500/25 active:scale-[0.98] disabled:opacity-40"
            onClick={() => chaos.mutate()}
            disabled={chaos.isPending}
          >
            💥 Crash a worker
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Column title="Queued" chips={flow.queued} accent="text-slate-300" empty="idle" />
        <Column
          title="Processing"
          chips={flow.processing}
          accent="text-blue-300"
          pulse
          empty="—"
        />
        <Column title="Completed" chips={flow.completed} accent="text-emerald-300" empty="—" />
        <Column title="Dead-letter" chips={flow.dead} accent="text-red-300" empty="none 🎉" />
      </div>

      {chaos.isSuccess && (
        <p className="mt-3 text-xs text-amber-300">
          💥 A worker was crashed mid-flight — its in-flight jobs will reappear in “Queued” as the
          reaper recovers them, then complete. Watch the flow.
        </p>
      )}
    </div>
  );
}
