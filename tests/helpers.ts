import type { PiEventHandler, PiRecord, PiTransport } from "../src/agent/rpc-client.js";
import { now, type SessionState } from "../src/types.js";

// Protocol replay only: this test double does not call a model or execute any task.
export class ReplayPi implements PiTransport {
  handlers = new Set<PiEventHandler>();
  commands: PiRecord[] = [];
  stopped = false;
  started = false;
  startError?: Error;
  constructor(public respond: (command: PiRecord, pi: ReplayPi) => Promise<PiRecord> = async (_command, pi) => {
    queueMicrotask(() => { pi.emit({ type: "message_start", message: { role: "assistant" } }); pi.emit({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "replayed test answer" }], stopReason: "stop" } }); pi.emit({ type: "agent_settled", aborted: false }); });
    return { type: "response", success: true, data: { disposition: "started" } };
  }) {}
  onEvent(handler: PiEventHandler) { this.handlers.add(handler); return () => { this.handlers.delete(handler); }; }
  emit(event: PiRecord) { for (const handler of this.handlers) handler(event); }
  async start() { if (this.startError) throw this.startError; this.started = true; }
  async request(command: PiRecord) { this.commands.push(command); return command.type === "prompt" ? this.respond(command, this) : { type: "response", success: true }; }
  async stop() { this.stopped = true; }
}
export function state(): SessionState {
  return { sessionId: crypto.randomUUID(), status: "idle", inputFiles: [], generatedFiles: [], artifacts: [], validations: [], eventLog: [], piTrace: [], createdAt: now(), updatedAt: now() };
}
