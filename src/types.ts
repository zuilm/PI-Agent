export type SessionStatus = "idle" | "running" | "failed" | "closed";
export type EventSource = "orchestrator" | "pi-model" | "sandbox" | "validator" | "web";
type BaseEvent = { runId: string; at: string; eventId?: number };
export type AgentEvent = BaseEvent & (
  | { type: "run_started"; source: "orchestrator"; sessionId: string }
  | { type: "assistant_start"; source: "pi-model"; messageId: string }
  | { type: "assistant_delta"; source: "pi-model"; messageId: string; delta: string }
  | { type: "assistant_message"; source: "pi-model"; messageId: string; text: string }
  | { type: "tool_started"; source: "sandbox" | "pi-model" | "web"; executor: string; toolCallId: string; name: string; args: unknown }
  | { type: "tool_update"; source: "sandbox" | "pi-model" | "web"; executor: string; toolCallId: string; name: string; result: unknown }
  | { type: "tool_finished"; source: "sandbox" | "pi-model" | "web"; executor: string; toolCallId: string; name: string; status: "ok" | "error"; result: unknown }
  | { type: "web_source"; source: "web"; toolCallId: string; page: WebSource }
  | { type: "validation_finished"; source: "validator"; report: ValidationReport }
  | { type: "artifact_ready"; source: "sandbox"; artifact: ArtifactMeta }
  | { type: "run_failed"; source: "orchestrator"; code: string; message: string; retryable: boolean }
  | { type: "run_settled"; source: "orchestrator"; ok: boolean; aborted?: boolean }
);
export type ArtifactMeta = { artifactId: string; sessionId: string; path: string; filename: string; contentType: string; size: number; sha256: string; createdAt: string };
export type WebSource = { url: string; title: string; domain: string; accessedAt: string; cached: boolean; characters: number; contentHash?: string; httpStatus?: number };
export type ValidationReport = { kind: string; ok: boolean; checks: Array<{ name: string; ok: boolean; details?: string }>; summary: Record<string, unknown> };
export type SessionState = {
  sessionId: string; status: SessionStatus; sandboxId?: string; inputFiles: string[]; generatedFiles: string[];
  artifacts: ArtifactMeta[]; validations: ValidationReport[]; eventLog: AgentEvent[];
  sources?: WebSource[];
  piTrace: Array<Record<string, any>>; lastInputPath?: string; createdAt: string; updatedAt: string;
};
export function now(): string { return new Date().toISOString(); }
export function id(prefix: string): string { return `${prefix}_${crypto.randomUUID()}`; }
