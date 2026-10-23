import test from "node:test";
import assert from "node:assert/strict";
import { AgentOrchestrator } from "../src/agent/runner.js";
import { ReplayPi, state } from "./helpers.js";

function setup(pi = new ReplayPi(), timeoutMs = 1000) {
  const session = state();
  const agent = new AgentOrchestrator((s, e) => s.eventLog.push(e), timeoutMs);
  return { session, agent, pi };
}
test("unrecognized tasks go to Pi verbatim without a sort fallback", async () => {
  const { session, agent, pi } = setup();
  await agent.run(session, "请分析 CSV 并画图", pi);
  assert.ok(pi.commands[0].message.endsWith("请分析 CSV 并画图"));
  assert.equal(session.status, "idle"); assert.equal(session.artifacts.length, 0);
  assert.equal(session.eventLog.some((e) => e.type === "tool_started"), false);
});
test("a task without uploads is accepted by the Pi session", async () => {
  const { session, agent, pi } = setup(); await agent.run(session, "编写一个函数", pi);
  assert.match(pi.commands[0].message, /最新输入：none/); assert.equal(session.status, "idle");
});
test("uploaded filenames and prior artifacts are included as metadata", async () => {
  const { session, agent, pi } = setup(); session.inputFiles.push("a.csv"); session.generatedFiles.push("/workspace/output/old.json");
  await agent.run(session, "继续分析", pi);
  assert.match(pi.commands[0].message, /\/workspace\/input\/a.csv/); assert.match(pi.commands[0].message, /old.json/);
});
test("streamed deltas and authoritative model text are both relayed", async () => {
  const pi = new ReplayPi(async (_command, replay) => {
    replay.emit({ type: "message_start", message: { role: "assistant" } });
    replay.emit({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "partial" } });
    replay.emit({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "final answer" }], stopReason: "stop" } });
    replay.emit({ type: "agent_settled" }); return { success: true };
  });
  const { session, agent } = setup(pi); await agent.run(session, "test", pi);
  assert.equal(session.eventLog.find((e) => e.type === "assistant_delta")?.delta, "partial");
  const final = session.eventLog.find((e) => e.type === "assistant_message");
  assert.equal(final?.text, "final answer"); assert.equal(final?.source, "pi-model");
});
test("agent_end does not settle a run before agent_settled", async () => {
  const pi = new ReplayPi(async (_command, replay) => { replay.emit({ type: "agent_end", willRetry: true }); return { success: true }; });
  const { session, agent } = setup(pi); const running = agent.run(session, "test", pi);
  await new Promise((done) => setImmediate(done)); assert.equal(session.status, "running");
  pi.emit({ type: "agent_settled" }); await running; assert.equal(session.status, "idle");
});
test("Pi tool start, update and failure events preserve tool IDs", async () => {
  const pi = new ReplayPi(async (_command, replay) => {
    replay.emit({ type: "tool_execution_start", toolCallId: "call1", toolName: "bash", args: { command: "false" } });
    replay.emit({ type: "tool_execution_update", toolCallId: "call1", toolName: "bash", partialResult: { content: [] } });
    replay.emit({ type: "tool_execution_end", toolCallId: "call1", toolName: "bash", result: { content: [{ text: "exit 1" }] }, isError: true });
    replay.emit({ type: "agent_settled" }); return { success: true };
  });
  const { session, agent } = setup(pi); await agent.run(session, "test", pi);
  const tool = session.eventLog.find((e) => e.type === "tool_finished"); assert.equal(tool?.toolCallId, "call1"); assert.equal(tool?.status, "error"); assert.equal(tool?.source, "sandbox");
});
test("MCP tool events are labeled Pi/MCP rather than E2B", async () => {
  const pi = new ReplayPi(async (_command, replay) => { replay.emit({ type: "tool_execution_start", toolCallId: "m1", toolName: "mcp__search__query", args: {} }); replay.emit({ type: "agent_settled" }); return { success: true }; });
  const { session, agent } = setup(pi); await agent.run(session, "search", pi);
  assert.equal(session.eventLog.find((e) => e.type === "tool_started")?.executor, "Pi/MCP");
});
test("final provider errors fail the run without fabricated fallback answers", async () => {
  const pi = new ReplayPi(async (_command, replay) => { replay.emit({ type: "message_end", message: { role: "assistant", content: [], stopReason: "error", errorMessage: "provider unavailable" } }); replay.emit({ type: "agent_settled" }); return { success: true }; });
  const { session, agent } = setup(pi); await agent.run(session, "test", pi);
  assert.equal(session.status, "failed"); assert.match(session.eventLog.find((e) => e.type === "run_failed")?.message ?? "", /provider unavailable/);
});
test("Pi can recover from an earlier provider error before settling", async () => {
  const pi = new ReplayPi(async (_command, replay) => {
    replay.emit({ type: "message_end", message: { role: "assistant", content: [], stopReason: "error" } });
    replay.emit({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "recovered" }], stopReason: "stop" } });
    replay.emit({ type: "agent_settled" }); return { success: true };
  });
  const { session, agent } = setup(pi); await agent.run(session, "test", pi); assert.equal(session.status, "idle");
});
test("Pi startup failure is visible", async () => {
  const { session, agent, pi } = setup(); pi.startError = new Error("binary missing"); await agent.run(session, "test", pi);
  assert.equal(session.status, "failed"); assert.equal(pi.commands.length, 0);
});
test("RPC command rejection is visible", async () => {
  const pi = new ReplayPi(async () => { throw new Error("prompt rejected"); });
  const { session, agent } = setup(pi); await agent.run(session, "test", pi); assert.equal(session.status, "failed");
});
test("unexpected Pi process exit fails promptly", async () => {
  const pi = new ReplayPi(async (_command, replay) => { replay.emit({ type: "process_error", message: "child exited" }); return { success: true }; });
  const { session, agent } = setup(pi); await agent.run(session, "test", pi); assert.equal(session.status, "failed");
});
test("run timeout asks Pi to abort and records failure", async () => {
  const pi = new ReplayPi(async () => ({ success: true })); const { session, agent } = setup(pi, 20);
  await agent.run(session, "test", pi); assert.equal(session.status, "failed"); assert.ok(pi.commands.some((c) => c.type === "abort"));
});
test("external cancellation records aborted settlement", async () => {
  const pi = new ReplayPi(async () => ({ success: true })); const { session, agent } = setup(pi);
  const controller = new AbortController(); const running = agent.run(session, "test", pi, "cancel", controller.signal);
  controller.abort(); await running; assert.equal(session.eventLog.find((e) => e.type === "run_settled")?.aborted, true);
});
test("handled extension commands do not wait for a nonexistent agent run", async () => {
  const pi = new ReplayPi(async () => ({ success: true, data: { disposition: "handled" } }));
  const { session, agent } = setup(pi); await agent.run(session, "/command", pi); assert.equal(session.status, "idle");
});
test("follow-up reuses the same Pi transport and retains trace", async () => {
  const { session, agent, pi } = setup(); await agent.run(session, "first", pi); await agent.run(session, "follow-up", pi);
  assert.equal(pi.commands.filter((c) => c.type === "prompt").length, 2); assert.equal(session.eventLog.filter((e) => e.type === "run_settled").length, 2); assert.equal(pi.handlers.size, 0); assert.ok(session.piTrace.length > 0);
});
test("delivery completes before run_settled and delivery failure is visible", async () => {
  const session = state();
  let delivered = false;
  const agent = new AgentOrchestrator((s, e) => { if (e.type === "run_settled" && e.ok) assert.equal(delivered, true); s.eventLog.push(e); }, 1000, async () => { delivered = true; });
  await agent.run(session, "test", new ReplayPi()); assert.equal(session.status, "idle");
  const failed = state();
  await new AgentOrchestrator((s, e) => s.eventLog.push(e), 1000, async () => { throw new Error("file delivery failed"); }).run(failed, "test", new ReplayPi());
  assert.equal(failed.status, "failed"); assert.match(failed.eventLog.find((e) => e.type === "run_failed")?.message ?? "", /file delivery failed/);
});
