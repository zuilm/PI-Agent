// Browser interaction regression only. ReplayPi + MemorySandbox do not call a model or execute code.
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, realpath, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { buildApp } from "../../src/server.js";
import { MemorySandboxProvider } from "../../src/sandbox/provider.js";
import { ReplayPi } from "../../tests/helpers.js";

const evidence = resolve("docs/evidence/current/ui-layout"); await mkdir(evidence, { recursive: true });
const requireWigolo = createRequire(await realpath(resolve("node_modules/wigolo/package.json")));
const { chromium } = requireWigolo("playwright");
const executablePath = [process.env.BROWSER_BIN, "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", chromium.executablePath()].find((p) => p && existsSync(p));
const clients: ReplayPi[] = [];
const { app, sessions } = await buildApp({ logger: false, sandboxFactory: () => new MemorySandboxProvider(), piFactory: (options) => {
  const pi = new ReplayPi(async (command, replay) => {
    queueMicrotask(() => { void (async () => {
      if (command.message.includes("等待停止")) { replay.emit({ type: "tool_execution_start", toolCallId: crypto.randomUUID(), toolName: "bash", args: { command: "# 协议回放：等待停止" } }); return; }
      replay.emit({ type: "message_start", message: { role: "assistant" } });
      replay.emit({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "我会先检查输入，再生成结果。" } });
      replay.emit({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "我会先检查输入，再生成结果。" }] } });
      const entry = sessions.get(options.sessionId)!;
      for (const [name, args, text] of [["read", { path: "/workspace/input/data.csv" }, "name,value\nalpha,12\nbeta,24\ngamma,36"], ["bash", { command: "# 协议回放，仅验证界面\npython summarize.py" }, "UI replay fixture: 3 rows, total 72"]] as const) {
        const toolCallId = crypto.randomUUID();
        replay.emit({ type: "tool_execution_start", toolCallId, toolName: name, args });
        replay.emit({ type: "tool_execution_update", toolCallId, toolName: name, partialResult: { content: [{ type: "text", text: "处理中…" }] } });
        replay.emit({ type: "tool_execution_end", toolCallId, toolName: name, isError: false, result: { content: [{ type: "text", text }] } });
      }
      await entry.sandbox.upload("/workspace/output/summary.txt", Buffer.from("UI replay fixture\nrows=3\ntotal=72\n"));
      replay.emit({ type: "message_start", message: { role: "assistant" } });
      replay.emit({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "## 界面回放示例\n已生成 **summary.txt**，包含 3 行数据的摘要。\n\n- 总计：72\n- 输出路径：`/workspace/output/summary.txt`\n\n```text\nrows=3\ntotal=72\n```\n\n[官方资料](https://fastify.dev/)\n[不安全链接](javascript:alert(1))\n<img src=x onerror=alert(1)>" }] } });
      replay.emit({ type: "agent_settled" });
    })().catch((error) => replay.emit({ type: "process_error", message: String(error) })); });
    return { success: true, data: { disposition: "started" } };
  }); clients.push(pi); return pi;
} });
const browser = await chromium.launch({ executablePath, headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, permissions: ["clipboard-read", "clipboard-write"] });
const page = await context.newPage(), errors: string[] = [], checks: string[] = [];
page.on("pageerror", (error: Error) => errors.push(error.message));
const check = (name: string) => { checks.push(name); console.log(`PASS: ${name}`); };
async function noOverflow() { assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, "Horizontal overflow"); }
try {
  await app.listen({ host: "127.0.0.1", port: 0 });
  await page.goto(`http://127.0.0.1:${(app.server.address() as { port: number }).port}`);
  await page.locator("#history button").waitFor(); assert.equal(sessions.size, 0);
  await noOverflow(); await page.screenshot({ path: resolve(evidence, "desktop-empty.png") }); check("packaged assets load, clean welcome, lazy sandbox creation");
  await page.locator("[data-prompt]").first().click(); assert.match(await page.locator("#prompt").inputValue(), /分析/); assert.equal(sessions.size, 0); check("suggestion fills composer without submitting");
  await page.locator("#file").setInputFiles({ name: "data.csv", mimeType: "text/csv", buffer: Buffer.from("name,value\nalpha,12\nbeta,24\ngamma,36") });
  await page.waitForFunction(() => document.querySelector("#file-status")!.textContent!.includes("已自动上传"));
  assert.match(await page.locator("#file-status").innerText(), /\/workspace\/input\/data.csv/); check("file selection automatically uploads and shows sandbox path");
  await page.locator("#prompt").fill("分析上传的数据，生成一份摘要文件"); await page.locator("#send").click();
  await page.waitForFunction(() => document.querySelector("#status")!.textContent === "已完成");
  assert.equal(await page.locator("#tools .tool").count(), 2); assert.equal(await page.locator("#tools .tool:visible").count(), 1);
  assert.match(await page.locator("#tool-page").innerText(), /2 \/ 2/); check("start/update/finish consolidate into one card per tool");
  await page.locator("#tools .tool:visible").getByRole("button", { name: "RAW", exact: true }).click();
  assert.match(await page.locator("#tools .raw-output:visible").innerText(), /toolCallId/);
  await page.locator("#tools .tool:visible").getByRole("button", { name: "UI", exact: true }).click();
  await page.locator("#previous-tool").click(); assert.match(await page.locator("#tools .tool:visible strong").innerText(), /read/);
  await page.locator("#next-tool").click(); check("UI/RAW switch and previous/next tool navigation");
  await page.locator("#tab-audit").click(); assert.ok(await page.locator("#audit .audit-entry").count() > 8);
  await page.locator("#audit details").first().locator("summary").click(); assert.match(await page.locator("#audit details[open]").innerText(), /run_started/);
  await page.locator("#tab-files").click(); assert.equal(await page.locator("#files .input-file").count(), 1); assert.equal(await page.locator("#files .artifact").count(), 1);
  await page.locator("#files .artifact button").click(); assert.match(await page.locator("#files .artifact pre").innerText(), /rows=3/);
  const downloadPromise = page.waitForEvent("download"); await page.locator("#files a[download]").click(); const download = await downloadPromise; assert.equal(download.suggestedFilename(), "summary.txt"); check("audit, real memory file metadata, preview and browser download");
  assert.equal(await page.locator("#messages .body h3").count(), 1); assert.ok(await page.locator("#messages .body code").count() > 0);
  assert.equal(await page.locator("#messages .body img").count(), 0); assert.equal(await page.locator("#messages a[href^='javascript:']").count(), 0); check("readable Markdown, unsafe HTML and URLs remain inert");
  await page.locator("#tab-progress").click();
  await page.locator("#copy-chat").click(); assert.match(await page.evaluate(() => navigator.clipboard.readText()), /summary.txt/);
  page.once("dialog", (dialog: any) => dialog.accept("数据摘要")); await page.locator("#rename-chat").click(); assert.equal(await page.locator("#chat-title").innerText(), "数据摘要");
  await page.locator("#collapse-nav").click(); assert.equal(await page.locator("body").evaluate((el: HTMLElement) => el.classList.contains("nav-collapsed")), true); await page.locator("#toggle-nav").click();
  await page.locator("#chat").evaluate((el: HTMLElement) => { el.scrollTop = el.scrollHeight; });
  await page.screenshot({ path: resolve(evidence, "desktop-replay.png") }); check("copy, rename and collapsible navigation");
  await page.locator("#prompt").fill("等待停止"); await page.locator("#send").click(); await page.locator("#abort:not([disabled])").waitFor();
  await page.locator("#new-chat").click(); assert.equal(await page.locator("#chat-title").innerText(), "新对话"); assert.equal(await page.locator("#messages").innerText(), "");
  await page.locator("#prompt").fill("另一段对话的草稿"); await page.locator("#history button").filter({ hasText: "数据摘要" }).click();
  assert.equal(await page.locator("#prompt").inputValue(), ""); await page.locator("#abort").click(); await page.waitForFunction(() => document.querySelector("#status")!.textContent === "已停止");
  assert.equal(await page.locator("#tools .tool:visible .tool-badge").innerText(), "Failed");
  await page.locator("#history button").filter({ hasText: "新对话" }).click(); assert.equal(await page.locator("#prompt").inputValue(), "另一段对话的草稿"); check("session switching preserves draft and running session; stop is real API cancellation");
  await page.route("**/api/sessions/*/files", (route: any) => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ message: "上传回放故障" }) }), { times: 1 });
  await page.locator("#file").setInputFiles({ name: "retry.txt", mimeType: "text/plain", buffer: Buffer.from("retry") });
  await page.locator("#upload:visible").waitFor(); assert.match(await page.locator("#file-status").innerText(), /上传失败/);
  await page.locator("#upload").click(); await page.waitForFunction(() => document.querySelector("#file-status")!.textContent!.includes("已自动上传")); check("failed upload exposes retry and retry succeeds");
  await page.locator("#history button").filter({ hasText: "数据摘要" }).click();
  for (const width of [1280, 950, 768]) { await page.setViewportSize({ width, height: 900 }); await noOverflow(); }
  await page.setViewportSize({ width: 390, height: 844 }); await noOverflow();
  await page.waitForFunction(() => document.querySelector('#inspector')!.getBoundingClientRect().left >= innerWidth - 1 && document.querySelector('.sidebar')!.getBoundingClientRect().right <= 1);
  await page.screenshot({ path: resolve(evidence, "mobile-conversation.png") });
  await page.locator("#toggle-nav").click(); await page.locator("#history").getByText("数据摘要", { exact: true }).click();
  await page.locator("#toggle-tools").click(); await page.locator("#tab-files").click(); await page.screenshot({ path: resolve(evidence, "mobile-files.png") });
  await page.locator("#close-tools").click(); assert.equal(await page.locator("#overlay").isVisible(), false);
  await page.locator("#toggle-tools").click(); await page.keyboard.press("Escape"); assert.equal(await page.locator("#overlay").isVisible(), false); check("responsive widths 1280/950/768/390, mobile navigation and workspace drawer");
  assert.equal(errors.length, 0, errors.join("\n")); check("zero browser JavaScript exceptions");
  await writeFile(resolve(evidence, "result.json"), JSON.stringify({ executedAt: new Date().toISOString(), mode: "real Edge browser + ReplayPi + MemorySandbox (no model or remote execution)", passed: true, checks }, null, 2));
} catch (error) { await page.screenshot({ path: resolve(evidence, "failure.png") }).catch(() => undefined); throw error; }
finally { await browser.close(); await app.close(); }
