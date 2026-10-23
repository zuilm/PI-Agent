import "dotenv/config";
import { E2BSandboxProvider } from "../../src/sandbox/provider.js";
import assert from "node:assert/strict";

const sandbox = new E2BSandboxProvider();
try {
  await sandbox.create();
  await sandbox.upload("/workspace/input/smoke.txt", new TextEncoder().encode("3,1 2\n"));
  const result = await sandbox.exec("python3 -c \"from pathlib import Path; import re; p=Path('/workspace/input/smoke.txt'); nums=[int(x) for x in re.split(r'[\\s,]+', p.read_text()) if x]; Path('/workspace/output/sorted.txt').write_text('\\n'.join(map(str, sorted(nums)))+'\\n')\"");
  if (result.exitCode !== 0) throw new Error(JSON.stringify(result));
  const output = new TextDecoder().decode(await sandbox.read("/workspace/output/sorted.txt"));
  assert.equal(output, "1\n2\n3\n");
  console.log(JSON.stringify({ ok: output === "1\n2\n3\n", output }));
} finally {
  await sandbox.destroy();
}
