"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

export function DeadLetterPanel({ onSelect }: { onSelect: (id: string) => void }) {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["dlq"], queryFn: () => api.deadLetter() });
  const requeue = useMutation({
    mutationFn: (id: string) => api.retryJob(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["dlq"] });
      qc.invalidateQueries({ queryKey: ["jobs"] });
      qc.invalidateQueries({ queryKey: ["stats"] });
    },
  });

  const rows = data?.deadLetter ?? [];

  return (
    <div className="panel">
      <div className="border-b border-white/[0.08] px-4 py-3">
        <h2 className="label">
          Dead-letter Queue <span className="text-rust">({rows.length})</span>
        </h2>
      </div>
      <div className="max-h-64 overflow-auto">
        {rows.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted">Nothing dead-lettered.</p>
        ) : (
          <ul className="divide-y divide-white/[0.05]">
            {rows.map((r) => (
              <li key={r.job_id} className="flex items-center gap-3 px-4 py-2 text-sm">
                <button
                  className="font-mono text-xs text-gold hover:underline"
                  onClick={() => onSelect(r.job_id)}
                >
                  {r.job_id.slice(0, 8)}
                </button>
                <span className="truncate font-mono text-xs text-rust/80">{r.failure_reason}</span>
                <button
                  className="btn ml-auto py-1"
                  onClick={() => requeue.mutate(r.job_id)}
                  disabled={requeue.isPending}
                >
                  Requeue
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
