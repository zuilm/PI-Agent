import { Sandbox, CommandExitError } from "e2b";
import { posix } from "node:path";
import type { CommandResult } from "e2b";

export type ExecResult = Pick<CommandResult, "exitCode" | "stdout" | "stderr" | "error">;

export interface SandboxProvider {
  readonly id: string;
  readonly sandboxId?: string;
  create(): Promise<void>;
  upload(path: string, data: Uint8Array): Promise<void>;
  read(path: string): Promise<Uint8Array>;
  exec(command: string, cwd?: string, timeoutMs?: number, signal?: AbortSignal): Promise<ExecResult>;
  list(path: string): Promise<string[]>;
  destroy(): Promise<void>;
}

export function normalizeSandboxPath(path: string): string {
  if (path !== "/workspace" && !path.startsWith("/workspace/")) throw new Error("Only /workspace paths are allowed");
  if (path.includes("\\") || path.includes("\0") || path.split("/").includes("..")) throw new Error("Path traversal is not allowed");
  const normalized = posix.normalize(path);
  if (normalized !== "/workspace" && !normalized.startsWith("/workspace/")) throw new Error("Only /workspace paths are allowed");
  return normalized;
}

export class E2BSandboxProvider implements SandboxProvider {
  id = "e2b";
  private sandbox?: Sandbox;
  get sandboxId(): string | undefined { return this.sandbox?.sandboxId; }

  async create(): Promise<void> {
    this.sandbox = await Sandbox.create({ timeoutMs: 30 * 60 * 1000 });
    await this.sandbox.files.makeDir("/workspace/input");
    await this.sandbox.files.makeDir("/workspace/output");
    await this.sandbox.files.makeDir("/workspace/work");
  }

  private get current(): Sandbox {
    if (!this.sandbox) throw new Error("Sandbox has not been created");
    return this.sandbox;
  }

  async upload(path: string, data: Uint8Array): Promise<void> {
    await this.current.files.write(normalizeSandboxPath(path), new Uint8Array(data).buffer);
  }

  async read(path: string): Promise<Uint8Array> {
    return this.current.files.read(normalizeSandboxPath(path), { format: "bytes" });
  }

  async exec(command: string, cwd = "/workspace", timeoutMs = 120_000, signal?: AbortSignal): Promise<ExecResult> {
    signal?.throwIfAborted();
    const handle = await this.current.commands.run(command, { cwd: normalizeSandboxPath(cwd), timeoutMs, requestTimeoutMs: 30_000, background: true });
    const abort = () => { void handle.kill().catch(() => undefined); };
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
    try {
      const result = await handle.wait();
      signal?.throwIfAborted();
      return result;
    } catch (error) {
      signal?.throwIfAborted();
      if (error instanceof CommandExitError) return { exitCode: error.exitCode, stdout: error.stdout, stderr: error.stderr, error: error.error };
      throw error;
    } finally { signal?.removeEventListener("abort", abort); }
  }

  async list(path: string): Promise<string[]> {
    const entries = await this.current.files.list(normalizeSandboxPath(path), { depth: 8 });
    return entries.filter((entry) => entry.type === "file").map((entry) => entry.path);
  }

  async destroy(): Promise<void> {
    if (this.sandbox) await this.sandbox.kill();
    this.sandbox = undefined;
  }
}

export class MemorySandboxProvider implements SandboxProvider {
  id = "memory";
  private files = new Map<string, Uint8Array>();

  async create(): Promise<void> {
    this.files.clear();
  }

  async upload(path: string, data: Uint8Array): Promise<void> {
    this.files.set(normalizeSandboxPath(path), new Uint8Array(data));
  }

  async read(path: string): Promise<Uint8Array> {
    const value = this.files.get(normalizeSandboxPath(path));
    if (!value) throw new Error(`File not found: ${path}`);
    return new Uint8Array(value);
  }

  async exec(_command: string): Promise<ExecResult> {
    throw new Error("MemorySandboxProvider is a file-storage test double and does not execute code. Use E2B for real execution.");
  }

  async list(path: string): Promise<string[]> {
    const prefix = normalizeSandboxPath(path).replace(/\/$/, "") + "/";
    return [...this.files.keys()].filter((key) => key.startsWith(prefix));
  }

  async destroy(): Promise<void> {
    this.files.clear();
  }
}

export function parseNumbers(text: string): number[] {
  const tokens = text.trim().split(/[\s,]+/).filter(Boolean);
  if (!tokens.length) throw new Error("Input file contains no numbers");
  const values = tokens.map((token) => {
    if (!/^[+-]?\d+$/.test(token)) throw new Error(`Invalid integer token: ${token}`);
    const value = Number(token);
    if (!Number.isSafeInteger(value)) throw new Error(`Integer is outside safe range: ${token}`);
    return value;
  });
  return values;
}
