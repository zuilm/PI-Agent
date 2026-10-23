import { z } from "zod";
import { createHash } from "node:crypto";
import type { SandboxProvider } from "./provider.js";
import { normalizeSandboxPath } from "./provider.js";
import { ArtifactStore } from "../artifacts/store.js";
import { validateMultiplesOf7, validateSortedNumbers } from "./validators.js";
import { now, type AgentEvent, type SessionState, type ValidationReport } from "../types.js";

const pathSchema = z.string().min(1).max(4096).transform(normalizeSandboxPath);
const shellQuote = (text: string) => `'${text.replaceAll("'", `'"'"'`)}'`;
export class ToolGateway {
  constructor(private readonly artifacts: ArtifactStore, private readonly emit: (state: SessionState, event: AgentEvent) => void) {}

  async execute(state: SessionState, sandbox: SandboxProvider, runId: string, operation: string, input: unknown, signal?: AbortSignal): Promise<unknown> {
    if (operation === "exec") {
      const args = z.object({ command: z.string().min(1).max(100_000), timeoutMs: z.number().int().min(100).max(300_000).default(120_000) }).parse(input);
      return sandbox.exec(args.command, "/workspace", args.timeoutMs, signal);
    }
    if (operation === "read" || operation === "stat") {
      const { path } = z.object({ path: pathSchema }).parse(input);
      const bytes = await sandbox.read(path);
      if (bytes.byteLength > 20 * 1024 * 1024) throw new Error("File is too large to read through the bridge");
      return operation === "stat" ? { path, size: bytes.byteLength } : { path, data: Buffer.from(bytes).toString("base64") };
    }
    if (operation === "write") {
      const { path, data } = z.object({ path: pathSchema, data: z.string().max(28 * 1024 * 1024) }).parse(input);
      if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(data)) throw new Error("Invalid base64 file data");
      const bytes = Buffer.from(data, "base64");
      await sandbox.upload(path, bytes);
      return { path, size: bytes.byteLength };
    }
    if (operation === "mkdir") {
      const { path } = z.object({ path: pathSchema }).parse(input);
      const result = await sandbox.exec(`mkdir -p -- ${shellQuote(path)}`, "/workspace", 30_000, signal);
      if (result.exitCode !== 0) throw new Error(result.stderr || "Sandbox mkdir failed");
      return { path };
    }
    if (operation === "publish") {
      const args = z.object({ path: pathSchema, validation: z.enum(["file", "integer-sort", "multiples-of-7"]).default("file"), inputPath: pathSchema.optional() }).parse(input);
      if (!args.path.startsWith("/workspace/output/")) throw new Error("Artifacts must be under /workspace/output/");
      if (args.validation !== "file" && !args.inputPath) throw new Error("Numeric validation requires inputPath");
      const outputBytes = await sandbox.read(args.path);
      const outputHash = createHash("sha256").update(outputBytes).digest("hex");
      if (args.validation === "file" && state.validations.some((r) => !r.ok && r.summary.path === args.path && r.summary.outputSha256 === outputHash)) throw new Error("This exact output failed semantic validation; repair it and rerun the validator");
      let report: ValidationReport;
      if (args.validation === "file") {
        const bytes = outputBytes;
        report = { kind: "file-integrity", ok: true, checks: [{ name: "output_readable", ok: true }], summary: { path: args.path, size: bytes.byteLength, sha256: createHash("sha256").update(bytes).digest("hex"), semanticValidation: "Not independently evaluated; inspect the model's code and tool evidence" } };
      } else {
        if (!args.inputPath) throw new Error("Numeric validation requires inputPath");
        report = await (args.validation === "integer-sort" ? validateSortedNumbers : validateMultiplesOf7)(sandbox, args.inputPath, args.path);
      }
      report.summary.path = args.path;
      report.summary.outputSha256 = outputHash;
      state.validations.push(report);
      this.emit(state, { type: "validation_finished", source: "validator", runId, report, at: now() });
      if (!report.ok) throw new Error("Artifact validation failed; fix the output before publishing");
      const artifact = await this.artifacts.register(state.sessionId, sandbox, args.path);
      const prior = state.artifacts.find((a) => a.path === artifact.path && a.sha256 === artifact.sha256);
      if (prior) return { artifact: prior, report, downloadUrl: `/api/artifacts/${prior.artifactId}?sessionId=${state.sessionId}` };
      state.artifacts.push(artifact);
      if (!state.generatedFiles.includes(args.path)) state.generatedFiles.push(args.path);
      this.emit(state, { type: "artifact_ready", source: "sandbox", runId, artifact, at: now() });
      return { artifact, report, downloadUrl: `/api/artifacts/${artifact.artifactId}?sessionId=${state.sessionId}` };
    }
    throw new Error(`Unsupported bridge operation: ${operation}`);
  }
}
