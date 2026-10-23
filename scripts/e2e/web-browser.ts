import "dotenv/config";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, realpath, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { buildApp } from "../../src/server.js";
import { prepareWebWorkspace, webEnvironment } from "../../src/web/environment.js";

const workspace = resolve("."), evidence = resolve("docs/evidence/current/web");
await mkdir(evidence, { recursive: true }); await prepareWebWorkspace(workspace);
const requireWigolo = createRequire(await realpath(resolve("node_modules/wigolo/package.json")));
const { chromium } = requireWigolo("playwright");
const executablePath = [process.env.BROWSER_BIN, "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "C:/Program Files/Google/Chrome/Application/chrome.exe", chromium.executablePath()].find((path) => path && existsSync(path));
if (!executablePath) throw new Error("Run pnpm setup:web or set BROWSER_BIN for browser verification");
const { app, sessions } = await buildApp({ logger: false });
const context = await chromium.launchPersistentContext(resolve(".pi/qa-browser", crypto.randomUUID()), { executablePath, headless: true, viewport: { width: 1500, height: 1000 }, env: webEnvironment(workspace) });
const page = await context.newPage();
const exceptions: string[] = []; page.on("pageerror", (error: Error) => exceptions.push(error.message));
try {
  await app.listen({ host: "127.0.0.1", port: 0 });
  const base = `http://127.0.0.1:${(app.server.address() as { port: number }).port}`;
  await page.goto(base);
  await page.locator("#prompt").fill("请实际调用 fetch 获取 https://fastify.dev/docs/latest/Guides/Getting-Started/ ，使用 render_js=never。根据正文用一句中文说明安装命令并附原始链接，不要搜索，不需要生成文件。");
  await page.locator("#send").click();
  await page.locator("#status").filter({ hasText: "已完成" }).waitFor({ timeout: 240_000 });
  const card = page.locator(".web-source").first();
  assert.ok(await card.count(), "No actual web source card");
  const anchor = card.locator("a");
  assert.equal(await anchor.getAttribute("href"), "https://fastify.dev/docs/latest/Guides/Getting-Started/");
  assert.equal(await anchor.getAttribute("target"), "_blank");
  assert.match(await anchor.getAttribute("rel"), /noopener/);
  assert.match(await card.innerText(), /网页正文已获取|本次访问/);
  assert.match(await page.locator("#tools").innerText(), /Pi MCP \/ wigolo/);
  assert.match(await page.locator("#messages").innerText(), /Pi 模型/);
  await page.locator("#chat").evaluate((element: HTMLElement) => { element.scrollTop = element.scrollHeight; });
  await page.screenshot({ path: resolve(evidence, "webui.png") });
  assert.equal(exceptions.length, 0);
  await writeFile(resolve(evidence, "ui-smoke.json"), JSON.stringify({ executedAt: new Date().toISOString(), mode: "real Edge/Chromium UI + model/Pi native MCP/wigolo/E2B", passed: true, checks: ["actual model fetch", "source card", "exact source URL", "safe clickable link", "actual access time", "MCP executor label", "model answer label", "zero JavaScript exceptions"], screenshot: "webui.png", states: [...sessions.values()].map((entry) => entry.state) }, null, 2));
  console.log("Real web source UI: PASS");
} catch (error) {
  await page.screenshot({ path: resolve(evidence, "ui-failure.png") }).catch(() => undefined);
  await writeFile(resolve(evidence, "ui-failure.json"), JSON.stringify({ executedAt: new Date().toISOString(), error: String(error), exceptions, states: [...sessions.values()].map((entry) => entry.state) }, null, 2));
  throw error;
} finally { await context.close(); await app.close(); }
