"use client";

import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { WS_BASE } from "./api";
import type { LiveEvent } from "./types";

/**
 * Subscribes to the API's WebSocket gateway and turns each live job event into a
 * React Query cache invalidation, so the dashboard updates with no polling. Returns
 * connection status plus a small rolling feed of the most recent events.
 */
const BUCKETS = 40; // seconds of throughput history

export type FlowChip = { id: string; type: string };
export type FlowState = {
  queued: FlowChip[];
  processing: FlowChip[];
  completed: FlowChip[];
  dead: FlowChip[];
};
type FlowEntry = { type: string; status: keyof FlowState; ts: number };
const EMPTY_FLOW: FlowState = { queued: [], processing: [], completed: [], dead: [] };

export function useLiveEvents(queue = "default") {
  const qc = useQueryClient();
  const [connected, setConnected] = useState(false);
  const [feed, setFeed] = useState<LiveEvent[]>([]);
  const [series, setSeries] = useState<number[]>(() => new Array(BUCKETS).fill(0));
  const [flow, setFlow] = useState<FlowState>(EMPTY_FLOW);
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const bucketsRef = useRef<number[]>(new Array(BUCKETS).fill(0));
  const flowRef = useRef<Map<string, FlowEntry>>(new Map());

  // Roll the throughput window once per second.
  useEffect(() => {
    const t = setInterval(() => {
      bucketsRef.current = [...bucketsRef.current.slice(1), 0];
      setSeries(bucketsRef.current);
    }, 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    let socket: WebSocket | null = null;
    let closedByUs = false;

    const connect = () => {
      socket = new WebSocket(`${WS_BASE}/ws?queue=${encodeURIComponent(queue)}`);

      socket.onopen = () => setConnected(true);
      socket.onclose = () => {
        setConnected(false);
        if (!closedByUs) reconnectRef.current = setTimeout(connect, 1500);
      };
      socket.onerror = () => socket?.close();

      socket.onmessage = (msg) => {
        let evt: LiveEvent;
        try {
          evt = JSON.parse(msg.data as string);
        } catch {
          return;
        }
        if (evt.event === "connected") return;

        // Refresh the lists/stats affected by this transition.
        qc.invalidateQueries({ queryKey: ["jobs"] });
        qc.invalidateQueries({ queryKey: ["stats"] });
        if (evt.event === "failed" && evt.outcome === "dead") {
          qc.invalidateQueries({ queryKey: ["dlq"] });
        }
        if (typeof evt.jobId === "string") {
          qc.invalidateQueries({ queryKey: ["job", evt.jobId] });
        }
        if (evt.event === "completed") {
          // Tally completions into the current second's bucket for the sparkline.
          const b = bucketsRef.current;
          b[b.length - 1] = (b[b.length - 1] ?? 0) + 1;
        }
        setFeed((f) => [evt, ...f].slice(0, 30));

        // --- live flow board state ---
        const m = flowRef.current;
        const put = (jid: string, status: keyof FlowState, type?: string) =>
          m.set(jid, { status, type: type ?? m.get(jid)?.type ?? "job", ts: Date.now() });
        const single = typeof evt.jobId === "string" ? evt.jobId : null;
        if (evt.event === "created" && single) put(single, "queued", evt.type);
        else if (evt.event === "started" && single) put(single, "processing", evt.type);
        else if (evt.event === "completed" && single) put(single, "completed", evt.type);
        else if (evt.event === "failed" && single)
          put(single, evt.outcome === "dead" ? "dead" : "queued", evt.type);
        else if (evt.event === "recovered") {
          const ids = Array.isArray(evt.jobId) ? evt.jobId : evt.jobId ? [evt.jobId] : [];
          ids.forEach((j) => put(String(j), "queued"));
        }
        // Trim to the most recent ~90 jobs so the board stays bounded.
        if (m.size > 90) {
          const oldest = [...m.entries()].sort((a, b) => a[1].ts - b[1].ts);
          for (let i = 0; i < m.size - 90; i++) m.delete(oldest[i]![0]);
        }
        const cols: FlowState = { queued: [], processing: [], completed: [], dead: [] };
        for (const [id, v] of m) cols[v.status].push({ id, type: v.type });
        setFlow({
          queued: cols.queued.slice(-28).reverse(),
          processing: cols.processing.slice(-16),
          completed: cols.completed.slice(-28).reverse(),
          dead: cols.dead.slice(-16).reverse(),
        });
      };
    };

    connect();
    return () => {
      closedByUs = true;
      if (reconnectRef.current) clearTimeout(reconnectRef.current);
      socket?.close();
    };
  }, [qc, queue]);

  return { connected, feed, series, flow };
}
