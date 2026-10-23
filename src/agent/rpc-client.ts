import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { resolve, join, dirname, delimiter } from "node:path";
import { StringDecoder } from "node:string_decoder";
import { id } from "../types.js";

export type PiRecord = Record<string, any>;
export type PiEventHandler = (event: PiRecord) => void;
export interface PiTransport {
  onEvent(handler: PiEventHandler): () => void;
  start(): Promise<void>;
  request(command: PiRecord, timeoutMs?: number): Promise<PiRecord>;
  stop(): Promise<void>;
}
export interface PiOptions {
  workspace: string;
  sessionId: string;
  bridgeUrl: string;
  bridgeToken: string;
  bin?: string;
}

export class PiRpcClient implements PiTransport {
  private child?: ChildProcessWithoutNullStreams;
  private starting?: Promise<void>;
  private stopping = false;
  private buffer = "";
  private decoder = new StringDecoder("utf8");
  private handlers = new Set<PiEventHandler>();
  private pending = new Map<string, { resolve: (r: PiRecord) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>();
  private stderr = "";
  constructor(private readonly options: PiOptions) {}

  onEvent(handler: PiEventHandler): () => void {
    this.handlers.add(handler);
    return () => { this.handlers.delete(handler); };
  }
  start(): Promise<void> {
    if (this.starting) return this.starting;
    if (this.child) return Promise.resolve();
    this.starting = this.launch().finally(() => { this.starting = undefined; });
    return this.starting;
  }
  private async launch(): Promise<void> {
    const { workspace, sessionId, bridgeUrl, bridgeToken } = this.options;
    const cwd = join(workspace, ".pi", "runtime", sessionId);
    const temporary = join(cwd, "tmp");
    await mkdir(temporary, { recursive: true });
    this.stopping = false;
    this.buffer = "";
    this.decoder = new StringDecoder("utf8");
    const args = ["--mode", "rpc", "--no-session", "--offline", "--no-context-files", "--no-extensions",
      "-e", join(workspace, ".pi", "extensions", "e2b.mjs"), "-e", "builtin:codemode", "-e", "builtin:tool-search", "-e", "builtin:mcp", "--no-builtin-tools"];
    if (process.env.PI_PROVIDER) args.push("--provider", process.env.PI_PROVIDER);
    if (process.env.PI_MODEL) args.push("--model", process.env.PI_MODEL);
    const child = spawn(resolve(workspace, this.options.bin ?? process.env.PI_BIN ?? ".pi/bin/pi.exe"), args, {
      cwd, windowsHide: true, stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, PATH: `${dirname(process.execPath)}${delimiter}${process.env.PATH ?? process.env.Path ?? ""}`, TEMP: temporary, TMP: temporary, TMPDIR: temporary, PI_CODING_AGENT_DIR: join(workspace, ".pi", "agent"), SPAWN_PI_BRIDGE_URL: bridgeUrl, SPAWN_PI_BRIDGE_TOKEN: bridgeToken },
    });
    this.child = child;
    child.stdout.on("data", (chunk: Buffer) => this.consume(chunk));
    child.stderr.on("data", (chunk: Buffer) => { this.stderr = (this.stderr + chunk.toString("utf8")).slice(-16_384); });
    child.on("error", (error) => this.failed(error));
    child.on("exit", (code, signal) => {
      if (this.child === child) this.child = undefined;
      if (!this.stopping) this.failed(new Error(`Pi exited unexpectedly (${code ?? signal})`));
    });
    try {
      await this.request({ type: "get_state" }, 20_000);
      const commands = await this.request({ type: "get_commands" });
      if (!commands.data?.commands?.some((c: PiRecord) => c.name === "sandbox-status")) throw new Error("Pi sandbox extension failed to load");
    } catch (error) {
      await this.stop();
      throw error;
    }
  }
  private failed(error: Error): void {
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(error); }
    this.pending.clear();
    if (!this.stopping) for (const handler of this.handlers) handler({ type: "process_error", message: error.message });
  }
  private consume(chunk: Buffer): void {
    this.buffer += this.decoder.write(chunk);
    for (;;) {
      const newline = this.buffer.indexOf("\n");
      if (newline < 0) break;
      const line = this.buffer.slice(0, newline).replace(/\r$/, "");
      this.buffer = this.buffer.slice(newline + 1);
      if (!line.trim()) continue;
      let event: PiRecord;
      try { event = JSON.parse(line) as PiRecord; }
      catch { this.failed(new Error("Malformed Pi RPC JSONL record")); continue; }
      if (event.type === "response" && event.id) {
        const pending = this.pending.get(event.id);
        if (pending) {
          clearTimeout(pending.timer); this.pending.delete(event.id);
          if (event.success) pending.resolve(event); else pending.reject(new Error(event.error ?? `Pi ${event.command} failed`));
        }
      }
      for (const handler of this.handlers) handler(event);
    }
  }
  request(command: PiRecord, timeoutMs = 20_000): Promise<PiRecord> {
    const child = this.child;
    if (!child?.stdin.writable) return Promise.reject(new Error("Pi RPC process is not running"));
    const requestId = id("rpc");
    return new Promise((resolveRequest, reject) => {
      const timer = setTimeout(() => { this.pending.delete(requestId); reject(new Error(`Pi RPC ${command.type} timeout`)); }, timeoutMs);
      this.pending.set(requestId, { resolve: resolveRequest, reject, timer });
      child.stdin.write(JSON.stringify({ ...command, id: requestId }) + "\n", (error) => {
        if (error) { clearTimeout(timer); this.pending.delete(requestId); reject(error); }
      });
    });
  }
  getStderr(): string { return this.stderr; }
  async stop(): Promise<void> {
    this.stopping = true;
    const child = this.child;
    this.child = undefined;
    this.failed(new Error("Pi RPC client closed"));
    if (!child || child.exitCode !== null) return;
    await new Promise<void>((done) => {
      const timer = setTimeout(() => { child.kill(); done(); }, 1500);
      child.once("exit", () => { clearTimeout(timer); done(); });
      child.stdin.end();
    });
  }
}
