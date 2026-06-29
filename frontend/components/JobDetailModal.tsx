"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { StatusBadge } from "./ui";

export function JobDetailModal({ id, onClose }: { id: string; onClose: () => void }) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["job", id],
    queryFn: () => api.getJob(id),
    refetchInterval: 2000,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["job", id] });
    qc.invalidateQueries({ queryKey: ["jobs"] });
    qc.invalidateQueries({ queryKey: ["stats"] });
  };
  const retry = useMutation({ mutationFn: () => api.retryJob(id), onSuccess: invalidate });
  const cancel = useMutation({ mutationFn: () => api.cancelJob(id), onSuccess: invalidate });

  const job = data?.job;

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-black/60"
      onClick={onClose}
    >
      <div
        className="h-full w-full max-w-md overflow-auto border-l border-white/[0.08] bg-[#11141a] p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between">
          <div>
            <h3 className="font-serif text-xl font-semibold">{job?.type ?? "Job"}</h3>
            <p className="mt-0.5 break-all font-mono text-xs text-muted">{id}</p>
          </div>
          <button className="btn" onClick={onClose}>
            ✕
          </button>
        </div>

        {isLoading || !job ? (
          <p className="mt-6 text-sm text-muted">Loading…</p>
        ) : (
          <>
            <div className="mt-4 flex items-center gap-3">
              <StatusBadge status={job.status} />
              <span className="text-xs text-muted">
                attempt {job.attempts}/{job.max_attempts} · priority {job.priority}
              </span>
            </div>

            <div className="mt-3 flex gap-2">
              <button
                className="btn"
                onClick={() => retry.mutate()}
                disabled={retry.isPending}
              >
                Retry
              </button>
              <button
                className="btn"
                onClick={() => cancel.mutate()}
                disabled={cancel.isPending}
              >
                Cancel
              </button>
            </div>

            {job.error && (
              <div className="mt-4 rounded-md border border-rust/30 bg-rust/10 p-3 font-mono text-xs text-rust">
                {job.error}
              </div>
            )}

            <section className="mt-5">
              <h4 className="label mb-2">Payload</h4>
              <pre className="overflow-auto rounded-md border border-white/[0.06] bg-black/30 p-3 font-mono text-xs text-ink">
                {JSON.stringify(job.payload, null, 2)}
              </pre>
            </section>

            <section className="mt-5">
              <h4 className="label mb-2">Timeline</h4>
              <ol className="space-y-2">
                {data!.events.map((e, i) => (
                  <li key={i} className="flex items-center gap-3 font-mono text-sm">
                    <span className="h-1.5 w-1.5 rounded-full bg-gold" />
                    <span className="font-medium">{e.event}</span>
                    {e.worker_id && <span className="text-xs text-muted">{e.worker_id}</span>}
                    <span className="ml-auto text-xs text-muted">
                      {new Date(e.created_at).toLocaleTimeString()}
                    </span>
                  </li>
                ))}
              </ol>
            </section>
          </>
        )}
      </div>
    </div>
  );
}
