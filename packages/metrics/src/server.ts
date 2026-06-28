import { createServer, type Server } from "node:http";
import { contentType, renderMetrics } from "./registry.js";

/**
 * Minimal standalone /metrics server, used by the worker process (which has no HTTP
 * surface of its own). The API serves /metrics from its existing Express app instead.
 */
export function startMetricsServer(port: number): Server {
  const server = createServer((req, res) => {
    if (req.url === "/metrics") {
      renderMetrics()
        .then((body) => {
          res.writeHead(200, { "content-type": contentType });
          res.end(body);
        })
        .catch(() => {
          res.writeHead(500);
          res.end("metrics error");
        });
      return;
    }
    res.writeHead(404);
    res.end();
  });
  server.listen(port);
  return server;
}
