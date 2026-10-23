import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { webEnvironment, webPaths } from "../src/web/environment.js";
import { fetchedSource } from "../src/web/sources.js";
import { AgentOrchestrator } from "../src/agent/runner.js";
import { ReplayPi, state } from "./helpers.js";

const at = "2026-10-22T10:00:00.000Z";
const page = { url: "https://example.org/data", title: "Official statistics", markdown: "# Source\nActual page body", cached: false, http_status: 200, content_hash: "abc" };
const result = (data: unknown) => ({ content: [{ type: "text", text: JSON.stringify(data) }] });

test("web configuration and caches relocate with the workspace", () => {
  for (const workspace of [resolve("first workspace"), resolve("moved 项目")]) {
    const paths = webPaths(workspace), env = webEnvironment(workspace, { PATH: "existing-path", E2B_API_KEY: "private", DASHSCOPE_API_KEY: "private", SPAWN_PI_BRIDGE_TOKEN: "private", SPAWN_PI_BRIDGE_URL: "private", WIGOLO_CONFIG_PATH: "old-path", PLAYWRIGHT_BROWSERS_PATH: "old-path" });
    assert.equal(env.WIGOLO_CONFIG_PATH, join(workspace, ".pi/web/config.json"));
    assert.equal(env.PLAYWRIGHT_BROWSERS_PATH, paths.browsers);
    assert.equal(env.E2B_API_KEY, undefined); assert.equal(env.DASHSCOPE_API_KEY, undefined);
    assert.equal(env.SPAWN_PI_BRIDGE_TOKEN, undefined); assert.equal(env.SPAWN_PI_BRIDGE_URL, undefined);
    assert.equal(env.WIGOLO_FETCH_ALLOW_PRIVATE, "false");
    for (const key of ["TEMP", "TMP", "TMPDIR", "HF_HOME", "TRANSFORMERS_CACHE", "FASTEMBED_CACHE_PATH", "WIGOLO_DATA_DIR", "WIGOLO_PLUGINS_DIR"]) assert.ok(env[key]?.startsWith(join(workspace, ".pi/web")), key);
  }
});

test("native Pi MCP exposes only search and fetch and resolves from session cwd", async () => {
  const { mcpServers } = JSON.parse(await readFile(".pi/agent/mcp.json", "utf8"));
  const config = mcpServers.web;
  assert.equal(config.exposure, "hidden");
  assert.deepEqual(config.toolExposure, { search: "direct", fetch: "direct" });
  const root = resolve("moved project"), sessionCwd = join(root, ".pi/runtime/session-id");
  assert.equal(resolve(sessionCwd, config.cwd), root);
  assert.equal(config.args.at(-1), "scripts/mcp/wigolo.ts");
});

test("actual fetch JSON preserves source URL, access time, status and hash", () => {
  assert.deepEqual(fetchedSource(result(page), at), { url: page.url, title: page.title, domain: "example.org", accessedAt: at, cached: false, characters: page.markdown.length, contentHash: "abc", httpStatus: 200 });
});
test("structured MCP content and cached responses are recognized", () => {
  assert.equal(fetchedSource({ structuredContent: { ...page, cached: true } }, at)?.cached, true);
});
test("search snippets and absent or malformed bodies cannot become fetched sources", () => {
  for (const value of [null, {}, result({ results: [page] }), result({ ...page, markdown: "  " }), result({ ...page, markdown: undefined }), { content: [{ type: "text", text: "not JSON" }] }]) assert.equal(fetchedSource(value, at), undefined);
});
test("failed fetches cannot become fetched sources", () => {
  for (const value of [{ ...result(page), isError: true }, result({ ...page, error: "blocked" }), result({ ...page, fetch_failed: true }), result({ ...page, http_status: 403 }), result({ ...page, http_status: 503 })]) assert.equal(fetchedSource(value, at), undefined);
});
test("source links reject non-web protocols and embedded credentials", () => {
  for (const url of ["javascript:alert(1)", "file:///etc/passwd", "https://user:password@example.org", "not a URL"]) assert.equal(fetchedSource(result({ ...page, url }), at), undefined);
});

test("replayed successful Pi fetch emits web source and preserves tool identity", async () => {
  const session = state();
  const pi = new ReplayPi(async (_command, replay) => {
    replay.emit({ type: "tool_execution_start", toolName: "mcp__web__fetch", toolCallId: "fetch-1", args: { url: page.url } });
    replay.emit({ type: "tool_execution_end", toolName: "mcp__web__fetch", toolCallId: "fetch-1", result: result(page), isError: false });
    replay.emit({ type: "agent_settled" }); return { success: true };
  });
  await new AgentOrchestrator((s, e) => s.eventLog.push(e), 1000).run(session, "fetch", pi);
  const source = session.eventLog.find((e) => e.type === "web_source");
  assert.equal(source?.toolCallId, "fetch-1"); assert.equal(source?.source, "web");
  assert.equal(session.sources?.[0].url, page.url);
  assert.equal(session.eventLog.find((e) => e.type === "tool_started")?.executor, "Pi MCP / wigolo");
});

test("replayed failed fetch and search never emit a source card", async () => {
  const session = state();
  const pi = new ReplayPi(async (_command, replay) => {
    for (const [toolName, isError] of [["mcp__web__search", false], ["mcp__web__fetch", true]] as const) replay.emit({ type: "tool_execution_end", toolName, toolCallId: toolName, result: result(page), isError });
    replay.emit({ type: "agent_settled" }); return { success: true };
  });
  await new AgentOrchestrator((s, e) => s.eventLog.push(e), 1000).run(session, "fetch", pi);
  assert.equal(session.sources, undefined); assert.equal(session.eventLog.some((e) => e.type === "web_source"), false);
});
