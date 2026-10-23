import "dotenv/config";
import Fastify from "fastify";
import multipart from "@fastify/multipart";
import { randomBytes, timingSafeEqual, createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ServerResponse } from "node:http";
import { z } from "zod";
import { ArtifactStore } from "./artifacts/store.js";
import { AgentOrchestrator } from "./agent/runner.js";
import { E2BSandboxProvider, type SandboxProvider } from "./sandbox/provider.js";
import { PiRpcClient, type PiOptions, type PiTransport } from "./agent/rpc-client.js";
import { ToolGateway } from "./sandbox/gateway.js";
import { id, now, type AgentEvent, type SessionState } from "./types.js";

export type SessionEntry = { state: SessionState; sandbox: SandboxProvider; pi: PiTransport; bridgeToken: string; subscribers: Set<ServerResponse>; runId?: string; running?: Promise<void>; controller?: AbortController; nextEventId: number };
export interface AppOptions { sandboxFactory?: () => SandboxProvider; piFactory?: (options: PiOptions) => PiTransport; logger?: boolean; workspace?: string; runTimeoutMs?: number }

export async function buildApp(options: AppOptions = {}) {
  const workspace = options.workspace ?? resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const app = Fastify({ logger: options.logger ?? true, bodyLimit: 30 * 1024 * 1024 });
  await app.register(multipart, { limits: { fileSize: 10 * 1024 * 1024, files: 5 } });
  const sessions = new Map<string, SessionEntry>();
  const artifacts = new ArtifactStore();
  const emit = (state: SessionState, event: AgentEvent) => {
    const entry = sessions.get(state.sessionId);
    event.eventId = entry ? ++entry.nextEventId : state.eventLog.length + 1;
    state.eventLog.push(event); state.updatedAt = now();
    const record = `id: ${event.eventId}\ndata: ${JSON.stringify(event)}\n\n`;
    for (const client of entry?.subscribers ?? []) if (!client.destroyed) client.write(record);
  };
  const gateway = new ToolGateway(artifacts, emit);
  const orchestrator = new AgentOrchestrator(emit, options.runTimeoutMs ?? Number(process.env.RUN_TIMEOUT_MS ?? 600000), async (state, runId) => {
    const entry = sessions.get(state.sessionId)!;
    for (const path of await entry.sandbox.list("/workspace/output")) {
      const bytes = await entry.sandbox.read(path);
      const hash = createHash("sha256").update(bytes).digest("hex");
      if (state.artifacts.some((a) => a.path === path && a.sha256 === hash)) continue;
      await gateway.execute(state, entry.sandbox, runId, "publish", { path, validation: "file" }, entry.controller?.signal);
    }
  });

  app.addHook("preClose", async () => {
    for (const entry of sessions.values()) { entry.controller?.abort(); for (const client of entry.subscribers) client.end(); }
  });
  app.addHook("onClose", async () => {
    await Promise.all([...sessions.values()].map(async (entry) => {
      entry.controller?.abort();
      await entry.running?.catch(() => undefined);
      await entry.pi.stop().catch(() => undefined);
      await entry.sandbox.destroy().catch(() => undefined);
    }));
    sessions.clear();
  });
  app.get("/", async (_request, reply) => reply.type("text/html; charset=utf-8").send(await readFile(join(workspace, "public/index.html"), "utf8")));
  for (const [asset, contentType] of [["app.css", "text/css"], ["app.js", "text/javascript"]]) {
    app.get(`/assets/${asset}`, async (_request, reply) => reply.type(`${contentType}; charset=utf-8`).send(await readFile(join(workspace, "public", asset), "utf8")));
  }
  app.get("/api/health", async () => ({ ok: true, agent: "pi-rpc", sandboxMode: "e2b", modelConfigured: Boolean(process.env.PI_MODEL) }));

  app.post("/api/sessions", async (_request, reply) => {
    const sessionId = id("session");
    const sandbox = options.sandboxFactory?.() ?? new E2BSandboxProvider();
    try {
      if (!options.piFactory && !process.env.PI_MODEL) throw new Error("请在工作区 .env 配置 PI_MODEL、PI_PROVIDER 和模型服务凭证");
      await sandbox.create();
      const address = app.server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      const bridgeToken = randomBytes(32).toString("hex");
      const piOptions = { workspace, sessionId, bridgeUrl: `http://127.0.0.1:${port}/internal/sessions/${sessionId}/tools`, bridgeToken };
      const pi = options.piFactory?.(piOptions) ?? new PiRpcClient(piOptions);
      const state: SessionState = { sessionId, status: "idle", sandboxId: sandbox.sandboxId ?? sandbox.id, inputFiles: [], generatedFiles: [], artifacts: [], validations: [], eventLog: [], piTrace: [], createdAt: now(), updatedAt: now() };
      sessions.set(sessionId, { state, sandbox, pi, bridgeToken, subscribers: new Set(), nextEventId: 0 });
      return { sessionId, status: "idle", agent: "pi-rpc", sandbox: sandbox.id };
    } catch (error) {
      await sandbox.destroy().catch(() => undefined);
      return reply.code(503).send({ error: "SESSION_CREATE_FAILED", message: error instanceof Error ? error.message : String(error) });
    }
  });

  app.get("/api/sessions/:id", async (request, reply) => {
    const entry = sessions.get((request.params as { id: string }).id);
    return entry ? entry.state : reply.code(404).send({ error: "SESSION_NOT_FOUND" });
  });

  app.post("/api/sessions/:id/files", async (request, reply) => {
    const entry = sessions.get((request.params as { id: string }).id);
    if (!entry) return reply.code(404).send({ error: "SESSION_NOT_FOUND" });
    if (entry.state.status === "running") return reply.code(409).send({ error: "SESSION_BUSY" });
    const staged: Array<{ filename: string; path: string; data: Buffer }> = [];
    for await (const part of request.parts()) {
      if (part.type !== "file") continue;
      const filename = part.filename.split(/[\\/]/).pop()!.replace(/[^a-zA-Z0-9._-]/g, "_");
      if (!filename || filename === "." || filename === "..") return reply.code(400).send({ error: "INVALID_FILENAME" });
      staged.push({ filename, path: `/workspace/input/${filename}`, data: await part.toBuffer() });
    }
    if (!staged.length) return reply.code(400).send({ error: "FILE_REQUIRED" });
    for (const file of staged) {
      await entry.sandbox.upload(file.path, file.data);
      if (!entry.state.inputFiles.includes(file.filename)) entry.state.inputFiles.push(file.filename);
      entry.state.lastInputPath = file.path;
    }
    return { uploaded: staged.map((f) => f.filename), paths: staged.map((f) => f.path), lastInputPath: entry.state.lastInputPath };
  });

  app.post("/api/sessions/:id/prompts", async (request, reply) => {
    const entry = sessions.get((request.params as { id: string }).id);
    if (!entry) return reply.code(404).send({ error: "SESSION_NOT_FOUND" });
    if (entry.state.status === "running") return reply.code(409).send({ error: "SESSION_BUSY" });
    const parsed = z.object({ message: z.string().trim().min(1).max(100_000) }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "PROMPT_REQUIRED", message: "message 必须为非空字符串" });
    const runId = id("run");
    entry.runId = runId; entry.controller = new AbortController();
    entry.running = orchestrator.run(entry.state, parsed.data.message, entry.pi, runId, entry.controller.signal);
    void entry.running.finally(() => { entry.runId = undefined; entry.controller = undefined; });
    return reply.code(202).send({ runId, status: "started" });
  });
  app.post("/api/sessions/:id/abort", async (request, reply) => {
    const entry = sessions.get((request.params as { id: string }).id);
    if (!entry) return reply.code(404).send({ error: "SESSION_NOT_FOUND" });
    entry.controller?.abort();
    await entry.running;
    return { status: entry.state.status };
  });

  app.post("/internal/sessions/:id/tools", async (request, reply) => {
    const entry = sessions.get((request.params as { id: string }).id);
    const supplied = request.headers.authorization?.replace(/^Bearer /, "") ?? "";
    if (!entry || supplied.length !== entry.bridgeToken.length || !timingSafeEqual(Buffer.from(supplied), Buffer.from(entry.bridgeToken))) return reply.code(403).send({ error: "BRIDGE_FORBIDDEN" });
    if (!entry.runId || entry.state.status !== "running") return reply.code(409).send({ error: "NO_ACTIVE_RUN" });
    const parsed = z.object({ operation: z.string(), args: z.unknown() }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "INVALID_TOOL_REQUEST" });
    const disconnected = new AbortController();
    const onClose = () => { if (!reply.raw.writableEnded) disconnected.abort(); };
    reply.raw.once("close", onClose);
    try { return await gateway.execute(entry.state, entry.sandbox, entry.runId, parsed.data.operation, parsed.data.args, entry.controller ? AbortSignal.any([entry.controller.signal, disconnected.signal]) : disconnected.signal); }
    catch (error) { return reply.code(422).send({ error: "SANDBOX_TOOL_FAILED", message: error instanceof Error ? error.message : String(error) }); }
    finally { reply.raw.removeListener("close", onClose); }
  });

  app.get("/api/sessions/:id/events", async (request, reply) => {
    const entry = sessions.get((request.params as { id: string }).id);
    if (!entry) return reply.code(404).send({ error: "SESSION_NOT_FOUND" });
    reply.hijack();
    reply.raw.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
    reply.raw.flushHeaders();
    const after = Number(request.headers["last-event-id"] ?? 0);
    for (const event of entry.state.eventLog) if ((event.eventId ?? 0) > after) reply.raw.write(`id: ${event.eventId}\ndata: ${JSON.stringify(event)}\n\n`);
    entry.subscribers.add(reply.raw);
    const heartbeat = setInterval(() => reply.raw.write(": heartbeat\n\n"), 15_000);
    reply.raw.on("close", () => { clearInterval(heartbeat); entry.subscribers.delete(reply.raw); });
  });

  app.get("/api/artifacts/:artifactId", async (request, reply) => {
    const artifactId = (request.params as { artifactId: string }).artifactId;
    const meta = artifacts.getMeta(artifactId);
    const bytes = artifacts.get(artifactId);
    if (!meta || !bytes) return reply.code(404).send({ error: "ARTIFACT_NOT_FOUND" });
    if (meta.sessionId !== (request.query as { sessionId?: string }).sessionId) return reply.code(403).send({ error: "ARTIFACT_FORBIDDEN" });
    const preview = (request.query as { preview?: string }).preview === "1";
    return reply.type(meta.contentType).header("Content-Disposition", `${preview ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(meta.filename)}`).header("X-Content-Type-Options", "nosniff").send(Buffer.from(bytes));
  });
  return { app, sessions, artifacts };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { app } = await buildApp();
  await app.listen({ host: process.env.HOST ?? "127.0.0.1", port: Number(process.env.PORT ?? 8787) });
  for (const name of ["SIGINT", "SIGTERM"] as const) process.once(name, () => { void app.close(); });
}
