import "dotenv/config";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { buildApp } from "../../src/server.js";
import type { SessionState } from "../../src/types.js";

const evidence = resolve("docs/evidence/current/web");
await mkdir(evidence, { recursive: true });
const { app, sessions } = await buildApp({ logger: false });
const results: Array<Record<string, any>> = [];
const streamed: Array<Record<string, any>> = [];
const controller = new AbortController();
let base = "", stream: Promise<void> | undefined;
async function json(path: string, payload?: unknown) {
  const response = await fetch(base + path, payload === undefined ? undefined : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
  const data = await response.json() as any;
  assert.ok(response.ok, JSON.stringify(data)); return data;
}
async function artifact(state: SessionState, filename: string) {
  const file = [...state.artifacts].reverse().find((a) => a.filename === filename);
  assert.ok(file, `Missing ${filename}`);
  const response = await fetch(`${base}/api/artifacts/${file.artifactId}?sessionId=${state.sessionId}`);
  assert.equal(response.status, 200);
  const text = await response.text(); await writeFile(resolve(evidence, filename), text); return text;
}
async function run(id: string, sessionId: string, prompt: string, check: (state: SessionState, events: SessionState["eventLog"]) => Promise<void>) {
  const startedAt = new Date().toISOString();
  console.log(`${id}: running real Pi/model/MCP/E2B...`);
  const { runId } = await json(`/api/sessions/${sessionId}/prompts`, { message: prompt });
  await sessions.get(sessionId)!.running;
  const state = await json(`/api/sessions/${sessionId}`) as SessionState;
  const events = state.eventLog.filter((e) => e.runId === runId);
  let error: string | undefined;
  try {
    assert.equal(state.status, "idle", JSON.stringify(events.filter((e) => e.type === "run_failed")));
    assert.ok(events.some((e) => e.type === "assistant_message" && e.text));
    await check(state, events);
  } catch (failure) { error = failure instanceof Error ? failure.message : String(failure); }
  results.push({ id, sessionId, runId, prompt, startedAt, completedAt: new Date().toISOString(), passed: !error, error, events, piTrace: state.piTrace.filter((e) => e.runId === runId), sources: state.sources, artifacts: state.artifacts });
  await writeFile(resolve(evidence, "real-e2e.json"), JSON.stringify({ executedAt: new Date().toISOString(), mode: "real model/Pi native MCP/wigolo/E2B/HTTP/SSE", total: results.length, passed: results.filter((r) => r.passed).length, results }, null, 2));
  console.log(`${id}: ${error ? `FAIL ${error}` : "PASS"}`);
}
try {
  await app.listen({ host: "127.0.0.1", port: 0 });
  base = `http://127.0.0.1:${(app.server.address() as { port: number }).port}`;
  const { sessionId } = await json("/api/sessions", {});
  sessions.get(sessionId)!.pi.onEvent((event) => {
    if (event.type === "tool_execution_start") console.log(`  Pi tool: ${event.toolName}`);
    if (event.type === "tool_execution_end" && event.isError) console.log(`  Pi tool error: ${event.toolName}`);
  });
  const response = await fetch(`${base}/api/sessions/${sessionId}/events`, { signal: controller.signal });
  stream = (async () => {
    const reader = response.body!.getReader(), decoder = new TextDecoder(); let buffer = "";
    try { for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      buffer += decoder.decode(value, { stream: true });
      for (;;) { const end = buffer.indexOf("\n\n"); if (end < 0) break;
        const block = buffer.slice(0, end); buffer = buffer.slice(end + 2);
        const line = block.split("\n").find((line) => line.startsWith("data: "));
        if (line) streamed.push(JSON.parse(line.slice(6)));
      }
    } } catch (error) { if (!controller.signal.aborted) throw error; }
  })();
  await run("W01", sessionId, "请实际调用联网 search 工具检索 Fastify 官方 Getting Started 文档，再使用 fetch 工具获取其中的官方页面正文。基于正文用中文简要说明 npm 安装命令以及服务器启动方式，附原始链接。不要只引用搜索摘要，不要调用 research 或子 Agent。生成 /workspace/output/sources.md，包含发布机构、页面标题、原始URL和本次访问时间，使用沙箱工具写入并校验发布。", async (state, events) => {
    assert.ok(events.some((e) => e.type === "tool_finished" && e.name === "mcp__web__search" && e.status === "ok"), "No native Pi MCP search");
    const fetched = events.filter((e) => e.type === "web_source");
    assert.ok(fetched.length && fetched.some((e) => e.page.domain === "fastify.dev" && e.page.characters > 500), "No actual official page body source");
    const source = await artifact(state, "sources.md");
    assert.match(source, /fastify/i); assert.match(source, /https:\/\/fastify\.dev/); assert.match(source, /2026/);
    const started = Date.parse(events.find((e) => e.type === "run_started")!.at);
    const times = [...source.matchAll(/20\d{2}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})?/g)].map(([raw]) => Date.parse(raw.replace(" ", "T") + (/(?:Z|[+-]\d{2}:\d{2})$/.test(raw) ? "" : "Z")));
    assert.ok(times.some((time) => time >= started - 60_000 && time <= Date.now() + 10_000), "Source artifact access time must be from this run, not old cache time");
    assert.ok(events.some((e) => e.type === "tool_finished" && e.name === "mcp__web__fetch" && JSON.stringify(e.result).includes("app_accessed_at")), "Pi native result hook did not annotate actual access time");
    assert.ok(events.some((e) => e.type === "tool_finished" && e.source === "sandbox"), "No E2B tool execution");
  });
  await run("W02", sessionId, "基于刚才的 Fastify 来源和 sources.md 继续。无需重新搜索。请在 E2B 使用 Python 程序从该文件提取 URL、按主机名去重计数，将包含 fastify.dev 的去重官方主机数写入 /workspace/output/source_count.json，格式为 {\"source_count\": 数值}。执行断言校验后发布，用一句中文说明结果。", async (state, events) => {
    assert.deepEqual(JSON.parse(await artifact(state, "source_count.json")), { source_count: 1 });
    assert.ok(events.some((e) => e.type === "tool_finished" && e.name === "bash" && e.source === "sandbox"));
  });
  await run("W03", sessionId, "这是失败处理测试。只调用 fetch 尝试访问 http://192.168.0.1:8787/ ，不要搜索或访问替代地址，也不要通过其他工具绕过限制。若工具拒绝访问，请明确告诉我失败原因，不要声称已读取页面，不要生成来源文件。", async (_state, events) => {
    assert.ok(events.some((e) => e.type === "tool_finished" && e.name === "mcp__web__fetch" && e.status === "error"), "No actual rejected fetch");
    const failure = events.find((e) => e.type === "tool_finished" && e.name === "mcp__web__fetch" && e.status === "error");
    assert.ok(failure?.type === "tool_finished");
    assert.match(JSON.stringify(failure.result), /private IPv4|private_target/, "A connection failure must not be counted as a policy rejection");
    assert.equal(events.some((e) => e.type === "web_source"), false);
    const answer = events.filter((e) => e.type === "assistant_message").map((e) => e.text).join("\n");
    assert.match(answer, /拒绝|禁止|失败|不允许|阻止|限制/);
  });
  await new Promise((done) => setTimeout(done, 100));
  assert.ok(streamed.some((e) => e.type === "web_source"), "No source SSE event");
  assert.ok(streamed.some((e) => e.type === "assistant_delta"));
  await writeFile(resolve(evidence, "sse-events.json"), JSON.stringify(streamed, null, 2));
  console.log(`Web real E2E: ${results.filter((r) => r.passed).length}/${results.length}`);
  if (results.some((r) => !r.passed)) process.exitCode = 1;
} finally { controller.abort(); await stream; await app.close(); }
