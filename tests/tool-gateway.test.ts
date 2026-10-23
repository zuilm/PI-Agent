import test from "node:test";
import assert from "node:assert/strict";
import { ArtifactStore } from "../src/artifacts/store.js";
import { MemorySandboxProvider, type ExecResult } from "../src/sandbox/provider.js";
import { ToolGateway } from "../src/sandbox/gateway.js";
import { state } from "./helpers.js";

async function setup() {
  const sandbox = new MemorySandboxProvider(); await sandbox.create(); const session = state(); const store = new ArtifactStore();
  return { sandbox, session, store, gateway: new ToolGateway(store, (s, e) => s.eventLog.push(e)) };
}
test("bridge file reads and writes preserve exact bytes", async () => {
  const { gateway, sandbox, session } = await setup();
  const bytes = Buffer.from([0, 255, 3, 10]);
  await gateway.execute(session, sandbox, "r", "write", { path: "/workspace/work/a.bin", data: bytes.toString("base64") });
  const result = await gateway.execute(session, sandbox, "r", "read", { path: "/workspace/work/a.bin" }) as { data: string };
  assert.deepEqual(Buffer.from(result.data, "base64"), bytes);
});
test("bridge rejects host paths", async () => {
  const { gateway, sandbox, session } = await setup(); await assert.rejects(gateway.execute(session, sandbox, "r", "read", { path: "C:/Windows/win.ini" }), /Only \/workspace/);
});
test("bridge rejects traversal", async () => {
  const { gateway, sandbox, session } = await setup(); await assert.rejects(gateway.execute(session, sandbox, "r", "write", { path: "/workspace/../secret", data: "" }), /Path traversal/);
});
test("bridge rejects invalid base64 rather than silently corrupting data", async () => {
  const { gateway, sandbox, session } = await setup(); await assert.rejects(gateway.execute(session, sandbox, "r", "write", { path: "/workspace/work/a", data: "!!" }), /base64/);
});
test("bridge rejects unsupported operations", async () => {
  const { gateway, sandbox, session } = await setup(); await assert.rejects(gateway.execute(session, sandbox, "r", "host_exec", {}), /Unsupported/);
});
test("bridge exec forwards arbitrary commands to the supplied sandbox", async () => {
  class SpySandbox extends MemorySandboxProvider { commands: string[] = []; override async exec(command: string): Promise<ExecResult> { this.commands.push(command); return { exitCode: 2, stdout: "", stderr: "controlled error" }; } }
  const sandbox = new SpySandbox(); const session = state();
  const gateway = new ToolGateway(new ArtifactStore(), () => {});
  const result = await gateway.execute(session, sandbox, "r", "exec", { command: "python3 custom_program.py" }) as ExecResult;
  assert.deepEqual(sandbox.commands, ["python3 custom_program.py"]); assert.equal(result.exitCode, 2);
});
test("bridge exec rejects excessive timeout", async () => {
  const { gateway, sandbox, session } = await setup(); await assert.rejects(gateway.execute(session, sandbox, "r", "exec", { command: "sleep 1", timeoutMs: 99999999 }));
});
test("publication rejects missing output without a success event", async () => {
  const { gateway, sandbox, session } = await setup(); await assert.rejects(gateway.execute(session, sandbox, "r", "publish", { path: "/workspace/output/missing.txt" }), /File not found/); assert.equal(session.artifacts.length, 0);
});
test("publication rejects files outside output directory", async () => {
  const { gateway, sandbox, session } = await setup(); await assert.rejects(gateway.execute(session, sandbox, "r", "publish", { path: "/workspace/input/a.txt" }), /Artifacts must/);
});
test("generic publication records integrity without claiming semantic validation", async () => {
  const { gateway, sandbox, session, store } = await setup(); await sandbox.upload("/workspace/output/report.json", Buffer.from('{"sum":8}'));
  await gateway.execute(session, sandbox, "r", "publish", { path: "/workspace/output/report.json" });
  assert.equal(session.artifacts.length, 1); assert.equal(session.validations[0].kind, "file-integrity"); assert.match(String(session.validations[0].summary.semanticValidation), /Not independently/); assert.ok(store.get(session.artifacts[0].artifactId));
});
test("numeric validation blocks a wrong artifact", async () => {
  const { gateway, sandbox, session } = await setup(); await sandbox.upload("/workspace/input/a.txt", Buffer.from("1 2 3")); await sandbox.upload("/workspace/output/a.txt", Buffer.from("1 2 4"));
  await assert.rejects(gateway.execute(session, sandbox, "r", "publish", { path: "/workspace/output/a.txt", validation: "integer-sort", inputPath: "/workspace/input/a.txt" }), /validation failed/);
  assert.equal(session.artifacts.length, 0); assert.equal(session.validations[0].ok, false);
});
test("numeric validation requires a source input", async () => {
  const { gateway, sandbox, session } = await setup(); await assert.rejects(gateway.execute(session, sandbox, "r", "publish", { path: "/workspace/output/a.txt", validation: "integer-sort" }), /requires inputPath/);
});
test("publishing the same content twice does not emit duplicate artifacts", async () => {
  const { gateway, sandbox, session } = await setup(); await sandbox.upload("/workspace/output/a.txt", Buffer.from("hello"));
  await gateway.execute(session, sandbox, "r", "publish", { path: "/workspace/output/a.txt" }); await gateway.execute(session, sandbox, "r", "publish", { path: "/workspace/output/a.txt" });
  assert.equal(session.artifacts.length, 1); assert.equal(session.eventLog.filter((e) => e.type === "artifact_ready").length, 1);
});
test("generic publication cannot bypass a failed numeric check of identical bytes", async () => {
  const { gateway, sandbox, session } = await setup();
  await sandbox.upload("/workspace/input/a.txt", Buffer.from("1 2 3")); await sandbox.upload("/workspace/output/a.txt", Buffer.from("1 2 4"));
  await assert.rejects(gateway.execute(session, sandbox, "r", "publish", { path: "/workspace/output/a.txt", inputPath: "/workspace/input/a.txt", validation: "integer-sort" }));
  await assert.rejects(gateway.execute(session, sandbox, "r", "publish", { path: "/workspace/output/a.txt" }), /failed semantic validation/);
  assert.equal(session.artifacts.length, 0);
});
