// Service entry Point B. Only listen to the local machine. C is called through the /api proxy of Vite. No automatic signature interface is provided.
import http from "node:http";
import { pathToFileURL } from "node:url";
import { configuredCoordinator } from "./lib/webCoordinator.mjs";
import runtime from "./lib/runtime.js";
import { safeErrorMessage } from "../shared/swapInputs.mjs";

export function json(value) {
  return JSON.stringify(value, (_key, item) => typeof item === "bigint" ? item.toString() : item);
}

export function createApiServer(service) {
  const handlers = {
    "/api/snapshot": (body) => service.snapshot(body.lookup, body.setup),
    "/api/prepare": (body) => service.prepare(body),
    "/api/confirm": (body) => service.confirm(body),
    "/api/transaction-status": (body) => service.transactionStatus(body)
  };
  return http.createServer(async (req, res) => {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    function reply(status, body) { res.writeHead(status); res.end(json(body)); }
    try {
      if (!/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(req.headers.host || "")) return reply(403, { error: "Local requests only." });
      const origin = req.headers.origin;
      if (origin && !/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin)) return reply(403, { error: "This origin is not allowed." });
      if (req.method === "GET" && req.url === "/api/health") return reply(200, {
        status: service.deploymentIssues?.length ? "read-only" : "ready",
        service: "task-b-coordinator", deploymentIssues: service.deploymentIssues || [],
        deploymentWarnings: service.deploymentWarnings || []
      });
      const handle = handlers[req.url];
      if (!handle || req.method !== "POST") return reply(404, { error: "Unknown API route." });
      if (!req.headers["content-type"]?.startsWith("application/json")) return reply(415, { error: "Send application/json." });
      const chunks = [];
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 32768) return reply(413, { error: "Request is too large." });
        chunks.push(chunk);
      }
      let body;
      try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
      catch { return reply(400, { error: "Invalid JSON request." }); }
      if (!body || typeof body !== "object" || Array.isArray(body)) return reply(400, { error: "Expected a JSON object." });
      try { reply(200, await handle(body)); }
      catch (error) {
        //Do not record requests; Mask the secrets, RPC addresses and environment private keys, and only return the readable reasons to the page.
        reply(400, { error: runtime.errorMessage(new Error(safeErrorMessage(error, [body.preimage]))) });
      }
    } catch {
      if (!res.headersSent) reply(400, { error: "Unable to process the coordinator request." });
      else res.end();
    }
  });
}

export async function startServer() {
  const { service, close } = await configuredCoordinator();
  for (const issue of service.deploymentIssues) console.warn(issue);
  const server = createApiServer(service);
  server.listen(3001, "127.0.0.1", () => console.log("Task B coordinator: http://127.0.0.1:3001 (MetaMask signs in the browser)"));
  server.on("error", (error) => { console.error(runtime.errorMessage(error)); close(); process.exitCode = 1; });
  for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => server.close(() => { close(); process.exit(0); }));
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startServer().catch((error) => { console.error(runtime.errorMessage(error)); process.exitCode = 1; });
}
