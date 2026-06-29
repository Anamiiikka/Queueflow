"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { StatusBadge } from "./ui";

const STATUSES = ["", "pending", "processing", "completed", "retrying", "dead", "cancelled"];

export function JobsTable({
  statusFilter,
  onFilter,
  onSelect,
}: {
  statusFilter: string;
  onFilter: (s: string) => void;
  onSelect: (id: string) => void;
}) {
  const { data, isLoading } = useQuery({
    queryKey: ["jobs", statusFilter],
    queryFn: () => api.listJobs({ status: statusFilter || undefined, limit: 50 }),
  });

  const jobs = data?.jobs ?? [];

  return (
    <div className="panel">
      <div className="flex items-center justify-between border-b border-edge px-4 py-3">
        <h2 className="text-sm font-semibold">Recent jobs</h2>
        <select
          className="input w-40 py-1 text-xs"
          value={statusFilter}
          onChange={(e) => onFilter(e.target.value)}
        >
          {STATUSES.map((s) => (
            <option key={s || "all"} value={s}>
              {s || "all statuses"}
            </option>
          ))}
        </select>
      </div>

      <div className="max-h-[28rem] overflow-auto">
        <table className="w-full text-left text-sm">
          <thead className="sticky top-0 bg-card text-xs uppercase text-muted">
            <tr>
              <th className="px-4 py-2 font-medium">Type</th>
              <th className="px-4 py-2 font-medium">Status</th>
              <th className="px-4 py-2 font-medium">Prio</th>
              <th className="px-4 py-2 font-medium">Attempts</th>
              <th className="px-4 py-2 font-medium">Updated</th>
            </tr>
          </thead>
          <tbody>
            {jobs.map((j) => (
              <tr
                key={j.id}
                onClick={() => onSelect(j.id)}
                className="cursor-pointer border-t border-edge/60 hover:bg-white/5"
              >
                <td className="px-4 py-2 font-medium">{j.type}</td>
                <td className="px-4 py-2">
                  <StatusBadge status={j.status} />
                </td>
                <td className="px-4 py-2 text-muted">{j.priority}</td>
                <td className="px-4 py-2 text-muted">
                  {j.attempts}/{j.max_attempts}
                </td>
                <td className="px-4 py-2 text-muted">
                  {new Date(j.updated_at).toLocaleTimeString()}
                </td>
              </tr>
            ))}
            {!isLoading && jobs.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-muted">
                  No jobs yet — enqueue some above.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
