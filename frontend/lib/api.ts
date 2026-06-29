import type { DeadLetterRow, JobDetail, QueueStats } from "./types";

/** Normalize the API base: a bare host (e.g. Render's fromService value) gets https://. */
function resolveApiBase(): string {
  const raw = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
  return raw.includes("://") ? raw.replace(/\/$/, "") : `https://${raw.replace(/\/$/, "")}`;
}

export const API_BASE = resolveApiBase();
export const WS_BASE = API_BASE.replace(/^http/, "ws");

const TOKEN_KEY = "qf_access_token";

export const tokenStore = {
  get: (): string | null => (typeof window === "undefined" ? null : localStorage.getItem(TOKEN_KEY)),
  set: (t: string) => localStorage.setItem(TOKEN_KEY, t),
  clear: () => localStorage.removeItem(TOKEN_KEY),
};

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = tokenStore.get();
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(init.headers ?? {}),
    },
  });
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, (body as { error?: string }).error ?? res.statusText);
  return body as T;
}

export interface CreateJobInput {
  type: string;
  priority?: number;
  payload?: Record<string, unknown>;
  delayMs?: number;
}

export const api = {
  // --- auth ---
  register: (email: string, password: string) =>
    request<{ accessToken: string }>("/auth/register", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),
  login: (email: string, password: string) =>
    request<{ accessToken: string }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),

  // --- jobs ---
  listJobs: (params: { status?: string; type?: string; limit?: number } = {}) => {
    const q = new URLSearchParams();
    if (params.status) q.set("status", params.status);
    if (params.type) q.set("type", params.type);
    q.set("limit", String(params.limit ?? 50));
    return request<{ jobs: JobDetail["job"][] }>(`/jobs?${q.toString()}`);
  },
  getJob: (id: string) => request<JobDetail>(`/jobs/${id}`),
  createJob: (input: CreateJobInput) =>
    request<{ jobId: string; deduplicated: boolean }>("/jobs", {
      method: "POST",
      body: JSON.stringify({ payload: {}, ...input }),
    }),
  retryJob: (id: string) => request<{ ok: boolean }>(`/jobs/${id}/retry`, { method: "POST" }),
  cancelJob: (id: string) => request<{ ok: boolean }>(`/jobs/${id}/cancel`, { method: "POST" }),
  deleteJob: (id: string) => request<void>(`/jobs/${id}`, { method: "DELETE" }),

  // --- admin ---
  stats: (queue = "default") => request<QueueStats>(`/admin/queues/${queue}/stats`),
  deadLetter: () => request<{ deadLetter: DeadLetterRow[] }>("/admin/dlq"),
  pause: (queue = "default") =>
    request<{ paused: boolean }>(`/admin/queues/${queue}/pause`, { method: "POST" }),
  resume: (queue = "default") =>
    request<{ paused: boolean }>(`/admin/queues/${queue}/resume`, { method: "POST" }),
};
