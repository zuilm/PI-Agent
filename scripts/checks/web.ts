// Diagnostic only. The application delegates MCP transport and tool calls to Pi.
import assert from "node:assert/strict";
import { mkdir, realpath, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { webEnvironment } from "../../src/web/environment.js";
import { fetchedSource } from "../../src/web/sources.js";

const workspace = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const requireWigolo = createRequire(await realpath(join(workspace, "node_modules/wigolo/package.json")));
const { Client } = await import(pathToFileURL(requireWigolo.resolve("@modelcontextprotocol/sdk/client/index.js")).href);
const { StdioClientTransport } = await import(pathToFileURL(requireWigolo.resolve("@modelcontextprotocol/sdk/client/stdio.js")).href);
const transport = new StdioClientTransport({ command: process.execPath, args: ["--import", "tsx", "scripts/mcp/wigolo.ts"], cwd: workspace, env: webEnvironment(workspace), stderr: "pipe" });
const client = new Client({ name: "spawn-pi-web-check", version: "1.0.0" });
let diagnostics = "";
transport.stderr?.on("data", (data: Buffer) => { diagnostics = (diagnostics + data).slice(-6000); });
const evidence = join(workspace, "docs/evidence/current/web");
const report: Record<string, any> = { executedAt: new Date().toISOString(), mode: "real wigolo stdio MCP/network; diagnostic SDK, no model", passed: false };
try {
  await client.connect(transport, { timeout: 30_000 });
  const tools = await client.listTools();
  report.tools = tools.tools.map((tool: any) => tool.name);
  assert.ok(report.tools.includes("search") && report.tools.includes("fetch"));
  console.log("Real MCP discovery: PASS");
  report.search = await client.callTool({ name: "search", arguments: { query: "site:fastify.dev Fastify Getting Started", max_results: 5, include_content: false, search_depth: "fast", force_refresh: true } }, undefined, { timeout: 90_000 });
  const search = report.search.content.filter((block: any) => block.type === "text").flatMap((block: any) => { try { return [JSON.parse(block.text)]; } catch { return []; } });
  assert.ok(search.some((data: any) => Array.isArray(data.results) && data.results.some((r: any) => r.url)), "Search returned no actual URLs");
  console.log("Real web search: PASS");
  report.fetch = await client.callTool({ name: "fetch", arguments: { url: "https://fastify.dev/docs/latest/Guides/Getting-Started/", render_js: "never", max_content_chars: 12000 } }, undefined, { timeout: 90_000 });
  report.source = fetchedSource(report.fetch, new Date().toISOString());
  assert.ok(report.source && report.source.characters > 500, "No actual page body fetched");
  console.log(`Real page fetch: PASS (${report.source.characters} characters)`);
  report.privateAddress = await client.callTool({ name: "fetch", arguments: { url: "http://192.168.0.1:8787/", render_js: "never" } }, undefined, { timeout: 30_000 });
  assert.equal(report.privateAddress.isError, true, "Private network request must be rejected");
  assert.match(JSON.stringify(report.privateAddress), /private IPv4|private_target/, "A network connection error is not proof of policy rejection");
  assert.equal(fetchedSource(report.privateAddress, new Date().toISOString()), undefined);
  console.log("Real private network rejection: PASS");
  report.passed = true;
} catch (error) {
  report.error = error instanceof Error ? error.message : String(error);
  console.error(report.error); process.exitCode = 1;
} finally {
  await client.close();
  report.diagnostics = diagnostics;
  await mkdir(evidence, { recursive: true });
  await writeFile(join(evidence, "mcp-check.json"), JSON.stringify(report, null, 2));
}
