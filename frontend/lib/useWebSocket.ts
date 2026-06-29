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

export function useLiveEvents(queue = "default") {
  const qc = useQueryClient();
  const [connected, setConnected] = useState(false);
  const [feed, setFeed] = useState<LiveEvent[]>([]);
  const [series, setSeries] = useState<number[]>(() => new Array(BUCKETS).fill(0));
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const bucketsRef = useRef<number[]>(new Array(BUCKETS).fill(0));

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
      };
    };

    connect();
    return () => {
      closedByUs = true;
      if (reconnectRef.current) clearTimeout(reconnectRef.current);
      socket?.close();
    };
  }, [qc, queue]);

  return { connected, feed, series };
}
