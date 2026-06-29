"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

const TYPES = ["email", "image", "pdf", "ai"];

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
      <h2 className="mb-3 text-sm font-semibold text-ink">Enqueue jobs</h2>
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs text-muted">
          Type
          <select className="input mt-1" value={type} onChange={(e) => setType(e.target.value)}>
            {TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-muted">
          Priority (1=high)
          <select
            className="input mt-1"
            value={priority}
            onChange={(e) => setPriority(Number(e.target.value))}
          >
            {[1, 2, 3, 4, 5].map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
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
        {note && <span className="text-xs text-emerald-400">{note}</span>}
      </div>
    </div>
  );
}
