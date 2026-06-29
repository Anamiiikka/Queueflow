"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Select } from "./Select";

const TYPE_OPTIONS = ["email", "image", "pdf", "ai"].map((t) => ({ value: t, label: t }));
const PRIORITY_OPTIONS = [1, 2, 3, 4, 5].map((p) => ({
  value: String(p),
  label: p === 1 ? "1 — highest" : p === 5 ? "5 — lowest" : String(p),
}));

export function EnqueueForm() {
  const qc = useQueryClient();
  const [type, setType] = useState("email");
  const [priority, setPriority] = useState(3);
  const [count, setCount] = useState(1);
  const [note, setNote] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: async () => {
      for (let i = 0; i < count; i++) {
        await api.createJob({ type, priority, payload: { demo: true, i } });
      }
    },
    onSuccess: () => {
      setNote(`enqueued ${count} ${type} job${count > 1 ? "s" : ""}`);
      qc.invalidateQueries({ queryKey: ["jobs"] });
      qc.invalidateQueries({ queryKey: ["stats"] });
      setTimeout(() => setNote(null), 2500);
    },
  });

  return (
    <div className="panel p-4">
      <h2 className="label mb-3">Enqueue Jobs</h2>
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs text-muted">
          Type
          <Select className="mt-1 w-36" value={type} onChange={setType} options={TYPE_OPTIONS} />
        </label>
        <label className="text-xs text-muted">
          Priority (1=high)
          <Select
            className="mt-1 w-40"
            value={String(priority)}
            onChange={(v) => setPriority(Number(v))}
            options={PRIORITY_OPTIONS}
          />
        </label>
        <label className="text-xs text-muted">
          Count
          <input
            className="input mt-1 w-24"
            type="number"
            min={1}
            max={100}
            value={count}
            onChange={(e) => setCount(Math.max(1, Math.min(100, Number(e.target.value))))}
          />
        </label>
        <button
          className="btn-primary"
          onClick={() => mutation.mutate()}
          disabled={mutation.isPending}
        >
          {mutation.isPending ? "…" : "Enqueue"}
        </button>
        {note && <span className="font-mono text-xs text-sage">{note}</span>}
      </div>
    </div>
  );
}
