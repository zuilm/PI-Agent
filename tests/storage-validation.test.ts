import test, { after } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { ArtifactStore } from "../src/artifacts/store.js";
import { AgentOrchestrator } from "../src/agent/runner.js";
import { MemorySandboxProvider, parseNumbers } from "../src/sandbox/provider.js";
import { validateMultiplesOf7, validateSortedNumbers } from "../src/sandbox/validators.js";
import { now, type AgentEvent, type SessionState } from "../src/types.js";

function makeSession(sessionId = `test_${crypto.randomUUID()}`): SessionState {
  return { sessionId, status: "idle", inputFiles: ["numbers.txt"], generatedFiles: [], artifacts: [], validations: [], eventLog: [], piTrace: [], lastInputPath: "/workspace/input/numbers.txt", createdAt: now(), updatedAt: now() };
}

async function memoryWithInput(text: string): Promise<MemorySandboxProvider> {
  const sandbox = new MemorySandboxProvider();
  await sandbox.create();
  await sandbox.upload("/workspace/input/numbers.txt", new TextEncoder().encode(text));
  return sandbox;
}

test("parseNumbers accepts signed integers and zero", () => {
  assert.deepEqual(parseNumbers("-2, 0\n+3"), [-2, 0, 3]);
});

test("parseNumbers rejects empty input", () => {
  assert.throws(() => parseNumbers(" ,\n "), /no numbers/i);
});

test("parseNumbers rejects unsafe integers", () => {
  assert.throws(() => parseNumbers("9007199254740992"), /safe range/i);
});

test("Memory Sandbox rejects host paths", async () => {
  const sandbox = new MemorySandboxProvider();
  await sandbox.create();
  await assert.rejects(() => sandbox.upload("C:\\temp\\file.txt", new Uint8Array()), /Only \/workspace paths/);
});

test("Memory Sandbox rejects traversal paths", async () => {
  const sandbox = new MemorySandboxProvider();
  await sandbox.create();
  await assert.rejects(() => sandbox.upload("/workspace/input/../secret", new Uint8Array()), /Path traversal/);
});

test("Memory Sandbox copies uploaded bytes", async () => {
  const sandbox = new MemorySandboxProvider();
  await sandbox.create();
  const bytes = new Uint8Array([1, 2, 3]);
  await sandbox.upload("/workspace/input/a.bin", bytes);
  bytes[0] = 9;
  assert.deepEqual([...await sandbox.read("/workspace/input/a.bin")], [1, 2, 3]);
});

test("sorted validator accepts duplicate values and reports summary", async () => {
  const sandbox = await memoryWithInput("3 1 2 2");
  await sandbox.upload("/workspace/output/sorted.txt", new TextEncoder().encode("1\n2\n2\n3\n"));
  const report = await validateSortedNumbers(sandbox, "/workspace/input/numbers.txt", "/workspace/output/sorted.txt");
  assert.equal(report.ok, true);
  assert.equal(report.summary.count, 4);
  assert.deepEqual(report.summary.first10, [1, 2, 2, 3]);
});

test("sorted validator rejects output that is not ascending", async () => {
  const sandbox = await memoryWithInput("1 2 3");
  await sandbox.upload("/workspace/output/bad.txt", new TextEncoder().encode("1\n3\n2\n"));
  const report = await validateSortedNumbers(sandbox, "/workspace/input/numbers.txt", "/workspace/output/bad.txt");
  assert.equal(report.ok, false);
  assert.equal(report.checks.find((check) => check.name === "ascending")?.ok, false);
});

test("sorted validator fails when output cannot be read", async () => {
  const sandbox = await memoryWithInput("1 2");
  await assert.rejects(() => validateSortedNumbers(sandbox, "/workspace/input/numbers.txt", "/workspace/output/missing.txt"), /File not found/);
});

test("multiples validator accepts expected descending output", async () => {
  const sandbox = await memoryWithInput("14 3 7 21 8 7");
  await sandbox.upload("/workspace/output/multiples.txt", new TextEncoder().encode("21\n14\n7\n7\n"));
  const report = await validateMultiplesOf7(sandbox, "/workspace/input/numbers.txt", "/workspace/output/multiples.txt");
  assert.equal(report.ok, true);
  assert.equal(report.summary.count, 4);
});

test("multiples validator rejects ascending or incomplete output", async () => {
  const sandbox = await memoryWithInput("7 14 21");
  await sandbox.upload("/workspace/output/bad.txt", new TextEncoder().encode("7\n14\n"));
  const report = await validateMultiplesOf7(sandbox, "/workspace/input/numbers.txt", "/workspace/output/bad.txt");
  assert.equal(report.ok, false);
  assert.equal(report.checks.find((check) => check.name === "matches_expected_filter")?.ok, false);
});

test("ArtifactStore records content hash and metadata", async () => {
  const sandbox = await memoryWithInput("1 2");
  await sandbox.upload("/workspace/output/result.txt", new TextEncoder().encode("1\n2\n"));
  const store = new ArtifactStore();
  const artifact = await store.register("session_a", sandbox, "/workspace/output/result.txt");
  assert.equal(artifact.filename, "result.txt");
  assert.equal(artifact.contentType, "text/plain; charset=utf-8");
  assert.equal(artifact.sha256, createHash("sha256").update("1\n2\n").digest("hex"));
  assert.deepEqual([...store.get(artifact.artifactId) ?? []], [...new TextEncoder().encode("1\n2\n")]);
});

test("ArtifactStore preserves session ownership in metadata", async () => {
  const sandbox = await memoryWithInput("1");
  await sandbox.upload("/workspace/output/result.txt", new TextEncoder().encode("1\n"));
  const artifact = await new ArtifactStore().register("session_a", sandbox, "/workspace/output/result.txt");
  assert.equal(artifact.sessionId, "session_a");
  assert.notEqual(artifact.sessionId, "session_b");
});

