"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ensureSession } from "@/lib/api";
import { useLiveEvents } from "@/lib/useWebSocket";
import { Sparkline, StatCard } from "@/components/ui";
import { EnqueueForm } from "@/components/EnqueueForm";
import { FlowBoard } from "@/components/FlowBoard";
import { JobsTable } from "@/components/JobsTable";
import { JobDetailModal } from "@/components/JobDetailModal";
import { DeadLetterPanel } from "@/components/DeadLetterPanel";

export default function DashboardPage() {
  const qc = useQueryClient();
  const [ready, setReady] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState("");

  // Frictionless: bootstrap a demo session in the background — no sign-in screen.
  useEffect(() => {
    ensureSession()
      .catch(() => {})
      .finally(() => setReady(true));
  }, []);

  const { connected, feed, series, flow } = useLiveEvents("default");
  const { data: stats } = useQuery({
    queryKey: ["stats"],
    queryFn: () => api.stats("default"),
    enabled: ready,
    refetchInterval: 5000,
  });
  const pause = useMutation({ mutationFn: () => api.pause() });
  const resume = useMutation({ mutationFn: () => api.resume() });

  const perMin = useMemo(() => series.reduce((a, b) => a + b, 0) * (60 / series.length), [series]);

  if (!ready) {
    return (
      <main className="flex min-h-screen items-center justify-center text-sm text-muted">
        connecting…
      </main>
    );
  }

  const totals = stats?.totals ?? {};
  const live = stats?.live ?? {};

  return (
    <main className="mx-auto max-w-6xl space-y-6 p-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-indigo-400 to-violet-600 text-lg font-black text-white shadow-lg shadow-indigo-500/30">
            Q
          </div>
          <div>
            <h1 className="text-xl font-semibold leading-tight">QueueFlow</h1>
            <p className="text-xs text-muted">Distributed job processing — live</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="panel flex items-center gap-3 px-3 py-1.5">
            <Sparkline data={series} className="h-7 w-24" />
            <div className="text-right">
              <div className="text-sm font-semibold tabular-nums text-ink">{Math.round(perMin)}</div>
              <div className="text-[10px] uppercase tracking-wide text-muted">jobs/min</div>
            </div>
          </div>
          <span
            className={`chip ${connected ? "bg-emerald-400/15 text-emerald-300" : "bg-red-400/15 text-red-300"}`}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${connected ? "bg-emerald-400 animate-pulse" : "bg-red-400"}`} />
            {connected ? "live" : "offline"}
          </span>
          <button className="btn" onClick={() => pause.mutate()}>
            Pause
          </button>
          <button className="btn" onClick={() => resume.mutate()}>
            Resume
          </button>
        </div>
      </header>

      <section className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard label="Pending" value={live.pending ?? 0} accent="indigo" />
        <StatCard label="Processing" value={live.processing ?? 0} accent="blue" />
        <StatCard label="Completed" value={totals.completed ?? 0} accent="emerald" />
        <StatCard label="Dead-letter" value={live.dlq ?? 0} accent="red" />
      </section>

      <FlowBoard flow={flow} />

      <EnqueueForm />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <LiveFeed feed={feed} />
        </div>
        <div className="space-y-6">
          <JobsTable statusFilter={statusFilter} onFilter={setStatusFilter} onSelect={setSelected} />
          <DeadLetterPanel onSelect={setSelected} />
        </div>
      </div>

      {selected && (
        <JobDetailModal
          id={selected}
          onClose={() => {
            setSelected(null);
            qc.invalidateQueries({ queryKey: ["jobs"] });
          }}
        />
      )}
    </main>
  );
}

const FEED_COLORS: Record<string, string> = {
  created: "text-slate-300",
  started: "text-blue-300",
  completed: "text-emerald-300",
  failed: "text-amber-300",
  recovered: "text-violet-300",
};

function LiveFeed({ feed }: { feed: ReturnType<typeof useLiveEvents>["feed"] }) {
  return (
    <div className="panel flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-white/[0.06] px-4 py-3">
        <h2 className="text-sm font-semibold">Live event feed</h2>
        <span className="text-xs text-muted">every state transition, as it happens</span>
      </div>
      <ul className="max-h-[34rem] flex-1 space-y-0.5 overflow-auto p-3 font-mono text-xs">
        {feed.length === 0 && (
          <li className="px-1 py-10 text-center text-muted">waiting for events…</li>
        )}
        {feed.map((e, i) => {
          const id = typeof e.jobId === "string" ? e.jobId : Array.isArray(e.jobId) ? `${e.jobId.length} jobs` : "";
          return (
            <li
              key={i}
              className="flex items-center gap-3 rounded-md px-2 py-1 hover:bg-white/5"
            >
              <span className="w-20 shrink-0 text-muted/70">
                {e.ts ? new Date(e.ts).toLocaleTimeString() : ""}
              </span>
              <span className={`w-24 shrink-0 font-semibold ${FEED_COLORS[e.event] ?? "text-indigo-300"}`}>
                {e.event}
              </span>
              <span className="w-16 shrink-0 text-ink">{e.type ?? ""}</span>
              {e.status && (
                <span className="rounded bg-white/5 px-1.5 py-0.5 text-[10px] text-muted">
                  {e.status}
                </span>
              )}
              <span className="ml-auto truncate text-muted/50">{id}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
