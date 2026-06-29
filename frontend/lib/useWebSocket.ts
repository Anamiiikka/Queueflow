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
export function useLiveEvents(queue = "default") {
  const qc = useQueryClient();
  const [connected, setConnected] = useState(false);
  const [feed, setFeed] = useState<LiveEvent[]>([]);
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

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

  return { connected, feed };
}
