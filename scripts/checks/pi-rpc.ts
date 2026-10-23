import { spawn } from "node:child_process";
import { join } from "node:path";
import assert from "node:assert/strict";
const bin = process.env.PI_BIN ?? join(process.cwd(), ".pi", "bin", "pi.exe");
const child = spawn(bin, ["--mode", "rpc", "--no-session", "--offline", "--no-tools", "--no-mcp", "--no-extensions", "--no-skills", "--no-context-files", "--no-prompt-templates"], {
  cwd: process.cwd(), stdio: ["pipe", "pipe", "pipe"], windowsHide: true,
  env: { ...process.env, PI_CODING_AGENT_DIR: join(process.cwd(), ".pi", "agent") },
});
let buffer = "";
try {
const result = await new Promise<Record<string, unknown>>((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error("Pi RPC timeout")), 5000);
  child.stdout.on("data", (chunk: Buffer) => {
    buffer += chunk.toString();
    const line = buffer.split("\n")[0];
    if (!line) return;
    try { const parsed = JSON.parse(line) as Record<string, unknown>; if (parsed.type === "response") { clearTimeout(timer); resolve(parsed); } } catch { /* wait for complete line */ }
  });
  child.once("error", (error) => { clearTimeout(timer); reject(error); });
  child.stdin.write(JSON.stringify({ id: "smoke", type: "get_state" }) + "\n");
});
assert.equal(result.command, "get_state");
assert.equal(result.success, true);
console.log(JSON.stringify({ ok: result.type === "response", command: result.command, success: result.success }));
} finally {
child.stdin.end();
child.kill();
}
