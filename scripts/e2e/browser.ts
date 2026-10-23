import "dotenv/config";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { buildApp } from "../../src/server.js";

const executable = [process.env.BROWSER_BIN, "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "C:/Program Files/Google/Chrome/Application/chrome.exe"].find((p) => p && existsSync(p));
if (!executable) throw new Error("Set BROWSER_BIN to a Chromium/Edge executable for UI verification");
const { app, sessions } = await buildApp({ logger: false });
const profile = resolve(".pi/qa-browser", crypto.randomUUID());
const evidence = resolve("docs/evidence/current");
const downloads = resolve(evidence, "browser-downloads", crypto.randomUUID());
await mkdir(downloads, { recursive: true });
let browser: ChildProcess | undefined;
let socket: WebSocket | undefined;
const pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>();
const exceptions: unknown[] = [];
let sequence = 0;
async function sleep(ms: number) { await new Promise((done) => setTimeout(done, ms)); }
async function command(method: string, params: Record<string, any> = {}): Promise<any> {
  const requestId = ++sequence;
  return new Promise((resolveCommand, reject) => {
    const timer = setTimeout(() => { pending.delete(requestId); reject(new Error(`CDP ${method} timed out`)); }, 30_000);
    pending.set(requestId, { resolve: resolveCommand, reject, timer });
    socket!.send(JSON.stringify({ id: requestId, method, params }));
  });
}
async function evaluate(expression: string): Promise<any> {
  const result = await command("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
  return result.result?.value;
}
async function until(expression: string, timeoutMs = 180_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) { if (await evaluate(expression)) return; await sleep(200); }
  throw new Error(`UI condition timed out: ${expression}`);
}
async function send(prompt: string) {
  await evaluate(`document.getElementById('prompt').value=${JSON.stringify(prompt)};document.getElementById('send').click()`);
  await until("document.getElementById('send').disabled === true");
  await until("document.getElementById('send').disabled === false && document.getElementById('status').textContent === '已完成'");
}
try {
  await app.listen({ host: "127.0.0.1", port: 0 });
  const base = `http://127.0.0.1:${(app.server.address() as { port: number }).port}`;
  browser = spawn(executable, ["--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"], { windowsHide: true, stdio: "ignore" });
  let debugPort: number | undefined;
  for (let i = 0; i < 100; i++) {
    try { debugPort = Number((await readFile(resolve(profile, "DevToolsActivePort"), "utf8")).split("\n")[0]); break; } catch { await sleep(100); }
  }
  assert.ok(debugPort, "Browser did not expose a debugging port");
  const tabs = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json() as any[];
  socket = new WebSocket(tabs.find((t) => t.type === "page").webSocketDebuggerUrl);
  socket.addEventListener("message", (message) => {
    const record = JSON.parse(String(message.data));
    if (record.method === "Runtime.exceptionThrown") exceptions.push(record.params);
    const request = pending.get(record.id);
    if (request) { clearTimeout(request.timer); pending.delete(record.id); if (record.error) request.reject(new Error(JSON.stringify(record.error))); else request.resolve(record.result); }
  });
  await new Promise<void>((done, reject) => { socket!.addEventListener("open", () => done(), { once: true }); socket!.addEventListener("error", () => reject(new Error("Browser connection failed")), { once: true }); });
  await command("Runtime.enable"); await command("Page.enable");
  await command("Emulation.setDeviceMetricsOverride", { width: 1500, height: 1000, deviceScaleFactor: 1, mobile: false });
  await command("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: downloads });
  await command("Page.navigate", { url: base });
  await until("document.getElementById('send') !== null");
  await send("请实际运行 Python 计算 6*7，用一句中文汇报结果，不需要输出文件。");
  assert.ok((await evaluate("document.getElementById('messages').textContent")).includes("42"));
  console.log("UI no-attachment model task: PASS");
  const documentNode = await command("DOM.getDocument");
  const fileNode = await command("DOM.querySelector", { nodeId: documentNode.root.nodeId, selector: "#file" });
  await command("DOM.setFileInputFiles", { nodeId: fileNode.nodeId, files: [resolve("tests/fixtures/shuffled_numbers_10000.txt")] });
  await until("document.getElementById('file-status').textContent.includes('已自动上传')");
  console.log("UI automatic upload: PASS");
  await send("请将刚上传文件的整数按升序排列，编写可复用的程序并在沙箱运行。生成 output/sorted_numbers_asc.txt，使用整数排序校验后发布。用中文汇报总数、最小值、最大值和前后10个数字。");
  const artifacts = await evaluate("Array.from(document.querySelectorAll('.artifact')).map(el=>el.textContent)");
  assert.ok(artifacts.some((text: string) => text.includes("/workspace/output/sorted_numbers_asc.txt")));
  assert.ok((await evaluate("document.getElementById('tools').textContent")).includes("E2B Sandbox"));
  const link = await evaluate("Array.from(document.querySelectorAll('.artifact a')).find(el=>el.download==='sorted_numbers_asc.txt').href");
  const response = await fetch(link);
  assert.equal(response.status, 200);
  const downloaded = await response.text();
  const integers = downloaded.trim().split(/[\s,]+/).map(Number);
  assert.equal(integers.length, 10000, "Downloaded integer count");
  assert.ok(integers.every((value, index) => value === index + 1), "Downloaded integers must match the complete ascending golden sequence");
  await evaluate("Array.from(document.querySelectorAll('.artifact a')).find(el=>el.download==='sorted_numbers_asc.txt').click()");
  for (let i = 0; i < 100 && !existsSync(resolve(downloads, "sorted_numbers_asc.txt")); i++) await sleep(100);
  assert.equal(await readFile(resolve(downloads, "sorted_numbers_asc.txt"), "utf8"), downloaded);
  await evaluate("Array.from(document.querySelectorAll('.artifact')).find(el=>el.textContent.includes('sorted_numbers_asc.txt')).querySelector('button').click()");
  await until("document.querySelector('.artifact pre') !== null");
  assert.deepEqual((await evaluate("document.querySelector('.artifact pre').textContent")).trim().split(/[\s,]+/).slice(0, 3).map(Number), [1, 2, 3]);
  await evaluate("document.querySelector('#chat').scrollTop=document.querySelector('#chat').scrollHeight;document.querySelector('main>section:last-child').scrollTop=document.querySelector('main>section:last-child').scrollHeight");
  const screenshot = await command("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  await writeFile(resolve(evidence, "webui.png"), Buffer.from(screenshot.data, "base64"));
  assert.equal(exceptions.length, 0, JSON.stringify(exceptions));
  await writeFile(resolve(evidence, "ui-smoke.json"), JSON.stringify({ executedAt: new Date().toISOString(), mode: "real Edge browser + real model/Pi/E2B", passed: true, checks: ["task without attachment", "automatic upload", "streaming Pi answer", "native tool events", "sandbox output path", "exact 10000-number download", "actual browser download", "text preview", "zero JavaScript runtime exceptions"], screenshot: "webui.png" }, null, 2));
  console.log("UI streaming, tools, artifact download and preview: PASS; screenshot saved");
} catch (error) {
  await writeFile(resolve(evidence, "ui-failure.json"), JSON.stringify({ executedAt: new Date().toISOString(), error: String(error instanceof Error ? error.message : error).slice(0, 2000), states: [...sessions.values()].map((entry) => entry.state), exceptions }, null, 2));
  if (socket?.readyState === WebSocket.OPEN) {
    const screenshot = await command("Page.captureScreenshot", { format: "png" }).catch(() => undefined);
    if (screenshot) await writeFile(resolve(evidence, "ui-failure.png"), Buffer.from(screenshot.data, "base64"));
  }
  throw error;
} finally {
  if (socket?.readyState === WebSocket.OPEN) { await command("Browser.close").catch(() => undefined); socket.close(); }
  for (const p of pending.values()) { clearTimeout(p.timer); p.reject(new Error("Browser closed")); } pending.clear();
  browser?.kill(); await app.close();
}
