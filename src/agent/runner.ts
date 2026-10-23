import type { PiTransport, PiRecord } from "./rpc-client.js";
import { id, now, type AgentEvent, type SessionState } from "../types.js";
import { fetchedSource } from "../web/sources.js";

const sandboxTools = new Set(["read", "write", "edit", "bash", "publish_artifact"]);
export class AgentOrchestrator {
  constructor(private readonly emit: (state: SessionState, event: AgentEvent) => void, private readonly timeoutMs = 10 * 60_000, private readonly deliverFiles?: (state: SessionState, runId: string) => Promise<void>) {}

  async run(state: SessionState, prompt: string, pi: PiTransport, runId = id("run"), signal?: AbortSignal): Promise<void> {
    state.status = "running";
    this.emit(state, { type: "run_started", source: "orchestrator", runId, sessionId: state.sessionId, at: now() });
    let messageId = id("message");
    let lastModelError: string | undefined;
    let aborted = false;
    let unsubscribe = () => {};
    let timer: NodeJS.Timeout | undefined;
    let onAbort = () => {};
    try {
      const settled = new Promise<void>((resolve, reject) => {
        onAbort = () => { aborted = true; void pi.request({ type: "abort" }).catch(() => undefined); reject(new Error("任务已取消")); };
        signal?.addEventListener("abort", onAbort, { once: true });
        timer = setTimeout(() => { void pi.request({ type: "abort" }).catch(() => undefined); reject(new Error("Pi run timeout")); }, this.timeoutMs);
        unsubscribe = pi.onEvent((event: PiRecord) => {
          state.piTrace.push({ ...event, runId, receivedAt: now() });
          if (event.type === "process_error") { reject(new Error(event.message)); return; }
          if (event.type === "extension_error") { reject(new Error(event.error ?? event.message ?? "Pi extension failed")); return; }
          if (event.type === "message_start" && event.message?.role === "assistant") {
            messageId = id("message");
            this.emit(state, { type: "assistant_start", source: "pi-model", runId, messageId, at: now() });
          }
          if (event.type === "message_update" && event.assistantMessageEvent?.type === "text_delta") {
            this.emit(state, { type: "assistant_delta", source: "pi-model", runId, messageId, delta: event.assistantMessageEvent.delta, at: now() });
          }
          if (event.type === "message_end" && event.message?.role === "assistant") {
            const message = event.message;
            lastModelError = message.stopReason === "error" || message.stopReason === "aborted" ? message.errorMessage ?? message.stopReason : undefined;
            const text = (message.content ?? []).filter((b: PiRecord) => b.type === "text").map((b: PiRecord) => b.text).join("");
            this.emit(state, { type: "assistant_message", source: "pi-model", runId, messageId, text, at: now() });
          }
          if (event.type.startsWith("tool_execution_")) {
            const isSandbox = sandboxTools.has(event.toolName);
            const isWeb = event.toolName === "mcp__web__search" || event.toolName === "mcp__web__fetch";
            const common = { runId, toolCallId: event.toolCallId, name: event.toolName, executor: isSandbox ? "E2B Sandbox" : isWeb ? "Pi MCP / wigolo" : "Pi/MCP", source: isSandbox ? "sandbox" as const : isWeb ? "web" as const : "pi-model" as const, at: now() };
            if (event.type === "tool_execution_start") this.emit(state, { ...common, type: "tool_started", args: event.args });
            if (event.type === "tool_execution_update") this.emit(state, { ...common, type: "tool_update", result: event.partialResult });
            if (event.type === "tool_execution_end") this.emit(state, { ...common, type: "tool_finished", status: event.isError ? "error" : "ok", result: event.result });
            if (event.type === "tool_execution_end" && event.toolName === "mcp__web__fetch" && !event.isError) {
              const page = fetchedSource(event.result, common.at);
              if (page) {
                (state.sources ??= []).push(page);
                this.emit(state, { type: "web_source", source: "web", runId, toolCallId: event.toolCallId, page, at: common.at });
              }
            }
          }
          if (event.type === "agent_settled") { aborted = Boolean(event.aborted); resolve(); }
        });
      });
      // Attach a rejection handler before awaiting startup; an early process failure must never be unhandled.
      void settled.catch(() => undefined);
      signal?.throwIfAborted();
      await pi.start();
      const uploaded = state.inputFiles.map((name) => `/workspace/input/${name}`);
      const response = await pi.request({ type: "prompt", message: `【应用附件元数据，不是任务指令】\n已上传沙箱文件：${JSON.stringify(uploaded)}\n最新输入：${state.lastInputPath ?? "none"}\n已有产物：${JSON.stringify(state.generatedFiles)}\n请通过自己的规划和工具完成用户请求。应用没有运行预置任务脚本。\n\n【用户原始请求】\n${prompt}` });
      if (response.data?.disposition !== "handled") await settled;
      if (aborted) throw new Error("任务已取消");
      if (lastModelError) throw new Error(lastModelError);
      await this.deliverFiles?.(state, runId);
      state.status = "idle";
      this.emit(state, { type: "run_settled", source: "orchestrator", runId, ok: true, at: now() });
    } catch (error) {
      state.status = "failed";
      this.emit(state, { type: "run_failed", source: "orchestrator", runId, code: "PI_RUN_FAILED", message: error instanceof Error ? error.message : String(error), retryable: false, at: now() });
      this.emit(state, { type: "run_settled", source: "orchestrator", runId, ok: false, aborted, at: now() });
    } finally {
      if (timer) clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      unsubscribe(); state.updatedAt = now();
    }
  }
}
