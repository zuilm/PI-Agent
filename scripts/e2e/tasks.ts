import "dotenv/config";
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { buildApp } from "../../src/server.js";
import type { SessionState } from "../../src/types.js";

const { app, sessions } = await buildApp({ logger: false });
const results: Array<Record<string, any>> = [];
const streamEvents: Array<Record<string, any>> = [];
let base = "";
const streamControllers: AbortController[] = [];
const streamReaders: Promise<void>[] = [];
async function json(path: string, body?: unknown) {
  const response = await fetch(base + path, body === undefined ? undefined : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = await response.json() as any;
  assert.ok(response.ok, `${response.status}: ${JSON.stringify(data)}`);
  return data;
}
async function newSession(): Promise<string> {
  const { sessionId } = await json("/api/sessions", {});
  const controller = new AbortController(); streamControllers.push(controller);
  const response = await fetch(`${base}/api/sessions/${sessionId}/events`, { signal: controller.signal });
  assert.equal(response.status, 200);
  streamReaders.push((async () => {
    const reader = response.body!.getReader(); const decoder = new TextDecoder(); let buffer = "";
    try { for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      buffer += decoder.decode(value, { stream: true });
      for (;;) { const index = buffer.indexOf("\n\n"); if (index < 0) break;
        const record = buffer.slice(0, index); buffer = buffer.slice(index + 2);
        const data = record.split("\n").find((line) => line.startsWith("data: "));
        if (data) streamEvents.push({ sessionId, ...JSON.parse(data.slice(6)) });
      }
    } } catch (error) { if (!controller.signal.aborted) throw error; }
  })());
  return sessionId;
}
async function upload(sessionId: string, name: string, data: Uint8Array) {
  const form = new FormData(); form.append("file", new Blob([new Uint8Array(data)]), name);
  const response = await fetch(`${base}/api/sessions/${sessionId}/files`, { method: "POST", body: form });
  assert.equal(response.status, 200);
}
async function file(state: SessionState, name: string): Promise<string> {
  const artifact = [...state.artifacts].reverse().find((a) => a.filename === name);
  assert.ok(artifact, `Missing artifact ${name}`);
  const response = await fetch(`${base}/api/artifacts/${artifact.artifactId}?sessionId=${state.sessionId}`);
  assert.equal(response.status, 200);
  const bytes = new Uint8Array(await response.arrayBuffer());
  await writeFile(`docs/evidence/current/artifacts/${name}`, bytes);
  return new TextDecoder().decode(bytes);
}
async function run(id: string, sessionId: string, prompt: string, check: (state: SessionState) => Promise<void>) {
  const startedAt = new Date().toISOString();
  const response = await json(`/api/sessions/${sessionId}/prompts`, { message: prompt });
  await sessions.get(sessionId)!.running;
  const state = await json(`/api/sessions/${sessionId}`) as SessionState;
  const events = state.eventLog.filter((e) => e.runId === response.runId);
  const answer = events.filter((e) => e.type === "assistant_message").map((e) => e.text).filter(Boolean).join("\n");
  let error: string | undefined;
  try {
    assert.equal(state.status, "idle", JSON.stringify(events.filter((e) => e.type === "run_failed")));
    assert.ok(events.some((e) => e.type === "tool_finished"), "No real Pi tool call was completed");
    assert.ok(events.some((e) => e.type === "assistant_message" && e.source === "pi-model" && e.text), "No model answer");
    assert.ok(state.piTrace.some((e) => e.runId === response.runId && e.type === "agent_settled"));
    await check(state);
  } catch (failure) { error = failure instanceof Error ? failure.message : String(failure); }
  results.push({ id, sessionId, runId: response.runId, mode: "real-model/pi.exe/E2B/HTTP/SSE", prompt, startedAt, completedAt: new Date().toISOString(), passed: !error, error, answer, tools: events.filter((e) => e.type === "tool_started").map((e) => ({ name: e.name, args: e.args })), events, piTrace: state.piTrace.filter((e) => e.runId === response.runId), artifacts: state.artifacts, validations: state.validations });
  await writeFile("docs/evidence/current/real-e2e.json", JSON.stringify({ executedAt: new Date().toISOString(), total: results.length, passed: results.filter((r) => r.passed).length, failed: results.filter((r) => !r.passed).length, results }, null, 2));
  console.log(`${id}: ${error ? `FAIL ${error}` : "PASS"} (${events.filter((e) => e.type === "tool_started").length} real tool calls)`);
}
try {
  await mkdir("docs/evidence/current/artifacts", { recursive: true });
  await app.listen({ host: "127.0.0.1", port: 0 });
  const address = app.server.address() as { port: number }; base = `http://127.0.0.1:${address.port}`;
  const example = await newSession();
  await upload(example, "numbers.txt", await readFile("tests/fixtures/shuffled_numbers_10000.txt"));
  const expected = Array.from({ length: 10_000 }, (_, i) => i + 1);
  await run("R01", example, "我上传了一份包含 10,000 个乱序整数的文本文件。请先分析文件结构并确认数据量，然后编写一个可复用的排序程序，在 Sandbox 中执行，将所有数字按升序排列，并生成 sorted_numbers_asc.txt 文件供我下载。完成后简要汇报总数、最小值、最大值、前10个和后10个数字，并验证排序结果是否正确。不要在对话中输出全部数字。请用整数排序校验发布文件。", async (state) => {
    const integers = (await file(state, "sorted_numbers_asc.txt")).trim().split(/[\s,]+/).map(Number);
    assert.equal(integers.length, expected.length);
    assert.ok(integers.every((value, index) => value === expected[index]), "Sorting output differs from the complete golden sequence");
    assert.ok(state.validations.some((v) => v.kind === "number-sort" && v.ok));
    const answer = state.eventLog.filter((e) => e.type === "assistant_message").map((e) => e.text).join("");
    assert.match(answer, /前\s*(?:10|十)/); assert.match(answer, /后\s*(?:10|十)/);
  });
  await run("R02", example, "请基于刚才处理的数据，筛选出所有能被7整除的数字，按降序排列，并生成 multiples_of_7_desc.txt。校验筛选结果后发布文件。", async (state) => {
    assert.deepEqual((await file(state, "multiples_of_7_desc.txt")).trim().split(/[\s,]+/).map(Number), expected.filter((n) => n % 7 === 0).reverse());
  });
  const general = await newSession();
  await run("R03", general, "无需上传文件。请编写并运行 Python 程序计算 1 到 100 的整数之和，把结果写入 output/series_sum.json，JSON 格式为 {\"sum\": 数值}。校验后发布文件。", async (state) => {
    assert.deepEqual(JSON.parse(await file(state, "series_sum.json")), { sum: 5050 });
  });
  await upload(general, "small_numbers.txt", new TextEncoder().encode("3 1 2 2"));
  await run("R04", general, "请分析刚上传的 input/small_numbers.txt，编写运行程序计算总和和平均值。生成 output/statistics.json，键名为 sum 和 mean；校验后发布文件。", async (state) => {
    assert.deepEqual(JSON.parse(await file(state, "statistics.json")), { sum: 8, mean: 2 });
  });
  await run("R05", general, "复用刚才的小整数文件，删除重复整数，按降序输出 output/unique_desc.txt，一行一个整数，校验后发布。", async (state) => {
    assert.deepEqual((await file(state, "unique_desc.txt")).trim().split(/\s+/).map(Number), [3, 2, 1]);
  });
  await run("R06", general, "仍基于原始 small_numbers.txt，只保留偶数，保留重复值，生成 output/even_numbers.txt，一行一个整数，校验后发布。", async (state) => {
    assert.deepEqual((await file(state, "even_numbers.txt")).trim().split(/\s+/).map(Number), [2, 2]);
  });
  await run("R07", general, "仍基于原始 small_numbers.txt，筛选能被3整除的数字，生成 output/multiples_of_3.txt，一行一个整数，校验后发布。", async (state) => {
    assert.deepEqual((await file(state, "multiples_of_3.txt")).trim().split(/\s+/).map(Number), [3]);
  });
  await upload(general, "sales.csv", new TextEncoder().encode("category,amount\nA,10\nB,5\nA,20\n"));
  await run("R08", general, "分析刚上传的 input/sales.csv，按 category 汇总 amount，生成 output/category_totals.json，格式为 {\"A\":数值,\"B\":数值}。请编写程序运行并校验后发布。", async (state) => {
    assert.deepEqual(JSON.parse(await file(state, "category_totals.json")), { A: 30, B: 5 });
  });
  await run("R09", general, "基于刚才的 category_totals.json 编写绘图程序，绘制类别销售额柱状图并生成 output/category_chart.png，标题和坐标轴用英文以避免字体问题。检查图片有效后发布；缺少绘图库时可在沙箱安装。", async (state) => {
    const artifact = state.artifacts.find((a) => a.filename === "category_chart.png"); assert.ok(artifact);
    const response = await fetch(`${base}/api/artifacts/${artifact.artifactId}?sessionId=${state.sessionId}&preview=1`);
    assert.equal(response.headers.get("content-type"), "image/png");
    const png = Buffer.from(await response.arrayBuffer()); assert.equal(png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
    assert.ok(png.readUInt32BE(16) > 0 && png.readUInt32BE(20) > 0);
    await writeFile("docs/evidence/current/artifacts/category_chart.png", png);
  });
  await upload(general, "buggy.py", new TextEncoder().encode("def add(a, b):\n    return a - b\n\nprint(add(2, 3))\n"));
  await run("R10", general, "input/buggy.py 中 add 函数写错了。请使用 edit 工具修改原文件，然后运行断言验证 add(2,3)=5 和 add(-1,1)=0。把修复后的代码复制到 output/fixed_add.py，把测试结果写入 output/add_result.json，格式为 {\"result\":5}，检查后发布这两个文件。", async (state) => {
    assert.deepEqual(JSON.parse(await file(state, "add_result.json")), { result: 5 });
    assert.match(await file(state, "fixed_add.py"), /return a \+ b/);
    assert.match(new TextDecoder().decode(await sessions.get(state.sessionId)!.sandbox.read("/workspace/input/buggy.py")), /return a \+ b/);
    assert.ok(state.eventLog.some((e) => e.type === "tool_started" && e.name === "edit"));
  });
  await new Promise((done) => setTimeout(done, 100));
  assert.ok(streamEvents.some((e) => e.type === "assistant_delta"));
  assert.ok(streamEvents.some((e) => e.type === "tool_started"));
  assert.ok(streamEvents.some((e) => e.type === "artifact_ready"));
  await writeFile("docs/evidence/current/sse-events.json", JSON.stringify(streamEvents, null, 2));
  console.log(`Real E2E: ${results.filter((r) => r.passed).length}/${results.length} passed; ${streamEvents.length} SSE records`);
  if (results.some((r) => !r.passed)) process.exitCode = 1;
} finally {
  for (const controller of streamControllers) controller.abort();
  await Promise.allSettled(streamReaders);
  await app.close();
}
