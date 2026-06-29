"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, tokenStore } from "@/lib/api";
import { useLiveEvents } from "@/lib/useWebSocket";
import { StatCard } from "@/components/ui";
import { EnqueueForm } from "@/components/EnqueueForm";
import { JobsTable } from "@/components/JobsTable";
import { JobDetailModal } from "@/components/JobDetailModal";
import { DeadLetterPanel } from "@/components/DeadLetterPanel";

export default function DashboardPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const [ready, setReady] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState("");

  // Client-side auth gate.
  useEffect(() => {
    if (!tokenStore.get()) router.replace("/login");
    else setReady(true);
  }, [router]);

  const { connected, feed } = useLiveEvents("default");
  const { data: stats } = useQuery({
    queryKey: ["stats"],
    queryFn: () => api.stats("default"),
    enabled: ready,
    refetchInterval: 5000,
  });
  const pause = useMutation({ mutationFn: () => api.pause() });
  const resume = useMutation({ mutationFn: () => api.resume() });

  if (!ready) return null;

  const totals = stats?.totals ?? {};
  const live = stats?.live ?? {};

  return (
    <main className="mx-auto max-w-6xl space-y-5 p-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">QueueFlow</h1>
          <p className="text-sm text-muted">Distributed job processing — live</p>
        </div>
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-2 text-xs text-muted">
            <span
              className={`h-2 w-2 rounded-full ${connected ? "bg-emerald-400" : "bg-red-400"}`}
            />
            {connected ? "live" : "offline"}
          </span>
          <button className="btn" onClick={() => pause.mutate()}>
            Pause
          </button>
          <button className="btn" onClick={() => resume.mutate()}>
            Resume
          </button>
          <button
            className="btn"
            onClick={() => {
              tokenStore.clear();
              router.replace("/login");
            }}
          >
            Sign out
          </button>
        </div>
      </header>

      <section className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard label="Pending" value={live.pending ?? 0} />
        <StatCard label="Processing" value={live.processing ?? 0} accent="text-blue-300" />
        <StatCard label="Completed" value={totals.completed ?? 0} accent="text-emerald-300" />
        <StatCard label="Dead-letter" value={live.dlq ?? 0} accent="text-red-300" />
      </section>

      <EnqueueForm />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <JobsTable
            statusFilter={statusFilter}
            onFilter={setStatusFilter}
            onSelect={setSelected}
          />
        </div>
        <div className="space-y-5">
          <DeadLetterPanel onSelect={setSelected} />
          <LiveFeed feed={feed} />
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

function LiveFeed({ feed }: { feed: ReturnType<typeof useLiveEvents>["feed"] }) {
  return (
    <div className="panel">
      <div className="border-b border-edge px-4 py-3">
        <h2 className="text-sm font-semibold">Live event feed</h2>
      </div>
      <ul className="max-h-64 space-y-1 overflow-auto p-3 font-mono text-xs">
        {feed.length === 0 && <li className="text-muted">waiting for events…</li>}
        {feed.map((e, i) => (
          <li key={i} className="flex items-center gap-2">
            <span className="text-muted">{e.ts ? new Date(e.ts).toLocaleTimeString() : ""}</span>
            <span className="text-indigo-300">{e.event}</span>
            {e.type && <span className="text-ink">{e.type}</span>}
            {e.status && <span className="text-muted">[{e.status}]</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}
