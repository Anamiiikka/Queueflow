"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ensureSession } from "@/lib/api";
import { useLiveEvents } from "@/lib/useWebSocket";
import { StatStrip } from "@/components/ui";
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
    <main className="mx-auto max-w-6xl space-y-6 px-6 py-7">
      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-white/[0.08] pb-6">
        <div>
          <h1 className="font-serif text-[2rem] font-semibold leading-none tracking-tight text-ink">
            QueueFlow<span className="text-gold">.</span>
          </h1>
          <p className="label mt-2.5">Distributed Job Queue</p>
        </div>

        <div className="flex items-center gap-5">
          <span className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.18em] text-muted">
            <span className={`h-1.5 w-1.5 rounded-full ${connected ? "bg-sage animate-pulse" : "bg-rust"}`} />
            {connected ? "live" : "idle"}
          </span>
          <div className="flex items-center gap-2">
            <button className="btn" onClick={() => pause.mutate()}>
              Pause
            </button>
            <button className="btn" onClick={() => resume.mutate()}>
              Resume
            </button>
          </div>
        </div>
      </header>

      <StatStrip
        items={[
          { label: "Throughput", value: Math.round(perMin), unit: "/min", tone: "gold", spark: series },
          { label: "Pending", value: live.pending ?? 0 },
          { label: "Processing", value: live.processing ?? 0, tone: "gold" },
          { label: "Completed", value: totals.completed ?? 0, tone: "sage" },
          { label: "Dead-letter", value: live.dlq ?? 0, tone: "rust" },
        ]}
      />

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
  created: "text-muted",
  started: "text-gold",
  completed: "text-sage",
  failed: "text-rust",
  recovered: "text-gold",
};

function LiveFeed({ feed }: { feed: ReturnType<typeof useLiveEvents>["feed"] }) {
  return (
    <div className="panel flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-white/[0.08] px-4 py-3">
        <h2 className="label">Live Event Feed</h2>
        <span className="font-mono text-[10px] text-muted/70">every state transition</span>
      </div>
      <ul className="max-h-[34rem] flex-1 divide-y divide-white/[0.04] overflow-auto font-mono text-xs">
        {feed.length === 0 && (
          <li className="px-4 py-12 text-center text-muted">waiting for events…</li>
        )}
        {feed.map((e, i) => {
          const id = typeof e.jobId === "string" ? e.jobId : Array.isArray(e.jobId) ? `${e.jobId.length} jobs` : "";
          return (
            <li key={i} className="flex items-center gap-3 px-4 py-1.5 hover:bg-white/[0.025]">
              <span className="w-20 shrink-0 text-muted/60">
                {e.ts ? new Date(e.ts).toLocaleTimeString() : ""}
              </span>
              <span className={`w-24 shrink-0 ${FEED_COLORS[e.event] ?? "text-ink"}`}>{e.event}</span>
              <span className="w-16 shrink-0 text-ink/80">{e.type ?? ""}</span>
              {e.status && <span className="text-muted">{e.status}</span>}
              <span className="ml-auto truncate text-muted/40">{id}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
