import type { Server } from "node:http";
import { Redis } from "ioredis";
import { WebSocketServer, type WebSocket } from "ws";
import { logger } from "@queueflow/shared";

/**
 * Live job-update gateway. A dedicated Redis connection pattern-subscribes to every
 * queue's event channel (q:*:events) and fans each message out to connected dashboard
 * clients. Clients may filter to one queue with ?queue=<name>.
 *
 * A separate connection is required because a subscribed ioredis client cannot run
 * normal commands — subscriber mode is exclusive.
 */
export function attachWebSocket(server: Server, redis: Redis): { close: () => Promise<void> } {
  const wss = new WebSocketServer({ server, path: "/ws" });
  const sub = redis.duplicate();

  const clients = new Map<WebSocket, { queue?: string }>();

  wss.on("connection", (socket, req) => {
    const url = new URL(req.url ?? "/ws", "http://localhost");
    const queue = url.searchParams.get("queue") ?? undefined;
    clients.set(socket, { queue });
    socket.send(JSON.stringify({ event: "connected", queue: queue ?? "*" }));
    socket.on("close", () => clients.delete(socket));
    socket.on("error", () => clients.delete(socket));
  });

  void sub.psubscribe("q:*:events").then(() => {
    logger.info("websocket gateway subscribed", { pattern: "q:*:events" });
  });

  sub.on("pmessage", (_pattern, channel, message) => {
    // channel = q:<queue>:events
    const queue = channel.split(":")[1];
    for (const [socket, opts] of clients) {
      if (socket.readyState !== socket.OPEN) continue;
      if (opts.queue && opts.queue !== queue) continue;
      socket.send(message);
    }
  });

  return {
    close: async () => {
      for (const socket of clients.keys()) socket.close();
      wss.close();
      await sub.quit().catch(() => {});
    },
  };
}
