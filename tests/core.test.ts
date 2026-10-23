import test from "node:test";
import assert from "node:assert/strict";
import { MemorySandboxProvider, normalizeSandboxPath, parseNumbers } from "../src/sandbox/provider.js";
import { validateMultiplesOf7, validateSortedNumbers } from "../src/sandbox/validators.js";

test("integer parsing accepts comma, whitespace, signs and duplicates", () => assert.deepEqual(parseNumbers("3, 1\n-2 +2 2"), [3, 1, -2, 2, 2]));
test("integer parsing rejects malformed tokens instead of silently dropping them", () => assert.throws(() => parseNumbers("1, nope"), /Invalid integer/));
test("zero-byte input is rejected", () => assert.throws(() => parseNumbers(""), /no numbers/));
test("workspace paths containing backslashes are rejected", () => assert.throws(() => normalizeSandboxPath("/workspace/input\\secret"), /Path traversal/));
test("workspace sibling paths are rejected", () => assert.throws(() => normalizeSandboxPath("/workspace-other/secret"), /Only \/workspace/));
test("ordinary filenames containing consecutive dots are allowed", () => assert.equal(normalizeSandboxPath("/workspace/output/result..txt"), "/workspace/output/result..txt"));
test("memory test double cannot masquerade as a real code executor", async () => assert.rejects(new MemorySandboxProvider().exec("echo success"), /does not execute code/));
test("sorted validator catches a changed multiset", async () => {
  const sandbox = new MemorySandboxProvider(); await sandbox.create();
  await sandbox.upload("/workspace/input/a.txt", new TextEncoder().encode("1 2 3"));
  await sandbox.upload("/workspace/output/b.txt", new TextEncoder().encode("1 2 4"));
  const report = await validateSortedNumbers(sandbox, "/workspace/input/a.txt", "/workspace/output/b.txt");
  assert.equal(report.ok, false); assert.equal(report.checks.find((c) => c.name === "multiset_preserved")?.ok, false);
});
test("multiples validator accepts an empty output when no source values qualify", async () => {
  const sandbox = new MemorySandboxProvider(); await sandbox.create();
  await sandbox.upload("/workspace/input/a.txt", new TextEncoder().encode("1 2 3"));
  await sandbox.upload("/workspace/output/b.txt", new Uint8Array());
  const report = await validateMultiplesOf7(sandbox, "/workspace/input/a.txt", "/workspace/output/b.txt");
  assert.equal(report.ok, true); assert.equal(report.summary.count, 0);
});
