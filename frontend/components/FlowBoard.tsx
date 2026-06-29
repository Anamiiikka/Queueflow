"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { FlowChip, FlowState } from "@/lib/useWebSocket";

const TYPE_DOT: Record<string, string> = {
  email: "bg-gold",
  image: "bg-sage",
  pdf: "bg-[#b08fd0]",
  ai: "bg-[#6fa8c7]",
};

function Chip({ chip }: { chip: FlowChip }) {
  return (
    <span
      className="flow-chip inline-flex items-center gap-1.5 rounded border border-white/10 bg-white/[0.03] px-1.5 py-0.5 font-mono text-[10px] text-ink/80"
      title={chip.id}
    >
      <span className={`h-1 w-1 rounded-full ${TYPE_DOT[chip.type] ?? "bg-muted"}`} />
      {chip.type}
    </span>
  );
}

const COLUMN: Record<string, string> = {
  queued: "text-muted",
  processing: "text-gold",
  completed: "text-sage",
  dead: "text-rust",
};

function Column({
  title,
  chips,
  variant,
  empty,
}: {
  title: string;
  chips: FlowChip[];
  variant: keyof typeof COLUMN;
  empty: string;
}) {
  return (
    <div className="flex min-h-[150px] flex-col rounded-md border border-white/[0.08] bg-black/20">
      <div className="flex items-center justify-between border-b border-white/[0.07] px-3 py-2">
        <span className={`label ${COLUMN[variant]}`}>{title}</span>
        <span className={`font-mono text-[11px] tabular-nums ${COLUMN[variant]}`}>{chips.length}</span>
      </div>
      <div className="flex flex-1 flex-wrap content-start gap-1.5 overflow-hidden p-2.5">
        {chips.length === 0 ? (
          <span className="m-auto font-mono text-[11px] text-muted/50">{empty}</span>
        ) : (
          chips.map((c) => <Chip key={c.id} chip={c} />)
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
    <div className="panel p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.07] pb-4">
        <div>
          <h2 className="label">Live Job Flow</h2>
          <p className="mt-1.5 text-sm text-muted">
            Drive the queue — then crash a worker and watch the engine recover every job.
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
            className="rounded-md border border-rust/40 px-3 py-1.5 text-sm font-medium text-rust transition hover:bg-rust/10 active:scale-[0.99] disabled:opacity-40"
            onClick={() => chaos.mutate()}
            disabled={chaos.isPending}
          >
            Crash a worker
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Column title="Queued" chips={flow.queued} variant="queued" empty="idle" />
        <Column title="Processing" chips={flow.processing} variant="processing" empty="—" />
        <Column title="Completed" chips={flow.completed} variant="completed" empty="—" />
        <Column title="Dead-letter" chips={flow.dead} variant="dead" empty="none 🎉" />
      </div>

      {chaos.isSuccess && (
        <p className="mt-3 font-mono text-[11px] text-gold">
          → worker crashed mid-flight. Its in-flight jobs reappear in Queued as the reaper recovers
          them, then complete.
        </p>
      )}
    </div>
  );
}
