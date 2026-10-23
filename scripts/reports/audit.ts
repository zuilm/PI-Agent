import "dotenv/config";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";

const root = "docs/evidence/current";
await mkdir(root, { recursive: true });
const tests = (await readdir("tests")).filter((name) => name.endsWith(".test.ts")).sort().map((name) => `tests/${name}`);
const commands = [
  { name: "typecheck", args: ["node_modules/typescript/bin/tsc", "--noEmit"], mode: "static", timeout: 120_000 },
  { name: "automated-tests", args: ["--import", "tsx", "--test", "--test-reporter=tap", ...tests], mode: "unit/injected-HTTP/real-socket-SSE; ReplayPi + memory file storage, no model/code execution", timeout: 120_000 },
  { name: "pi-rpc-smoke", args: ["--import", "tsx", "scripts/checks/pi-rpc.ts"], mode: "real-pi.exe/get_state; no model", timeout: 60_000 },
];
if (process.argv.includes("--real")) commands.push(
  { name: "real-e2e", args: ["--import", "tsx", "scripts/e2e/tasks.ts"], mode: "real-model/pi.exe/E2B/HTTP/SSE, 10 tasks", timeout: 30 * 60_000 },
);
if (process.argv.includes("--ui")) commands.push(
  { name: "ui-smoke", args: ["--import", "tsx", "scripts/e2e/browser.ts"], mode: "real Edge browser + real model/Pi/E2B", timeout: 10 * 60_000 },
);
if (process.argv.includes("--web")) commands.push(
  { name: "web-mcp", args: ["--import", "tsx", "scripts/checks/web.ts"], mode: "real-wigolo-MCP/network, no model", timeout: 5 * 60_000 },
  { name: "web-e2e", args: ["--import", "tsx", "scripts/e2e/web.ts"], mode: "real-model/Pi-native-MCP/wigolo/E2B/HTTP/SSE, 3 tasks", timeout: 30 * 60_000 },
);
if (process.argv.includes("--web-ui")) commands.push(
  { name: "web-ui", args: ["--import", "tsx", "scripts/e2e/web-browser.ts"], mode: "real browser/model/Pi-native-MCP source card", timeout: 6 * 60_000 },
);
commands.push({ name: "response-quality", args: ["--import", "tsx", "scripts/reports/quality.ts"], mode: "rule evaluation of saved actual model/tool/file evidence; no new model call", timeout: 60_000 });
const runs = [];
for (const command of commands) {
  const startedAt = new Date().toISOString();
  const result = spawnSync(process.execPath, command.args, { cwd: process.cwd(), env: process.env, encoding: "utf8", timeout: command.timeout, maxBuffer: 20 * 1024 * 1024, windowsHide: true });
  const output = result.stdout ?? "";
  await writeFile(`${root}/${command.name}.stdout.txt`, output);
  await writeFile(`${root}/${command.name}.stderr.txt`, (result.stderr ?? "") + (result.error ? String(result.error) : ""));
  const totals = command.name === "automated-tests" ? Object.fromEntries([...output.matchAll(/^# (tests|pass|fail|cancelled|skipped|todo) (\d+)$/gm)].map((m) => [m[1], Number(m[2])])) : undefined;
  runs.push({ name: command.name, mode: command.mode, command: ["node", ...command.args], startedAt, completedAt: new Date().toISOString(), exitCode: result.status, signal: result.signal, totals });
  console.log(`${command.name}: exit=${result.status}${totals ? ` ${JSON.stringify(totals)}` : ""}`);
  if (command.name === "pi-rpc-smoke" && result.status === 0) await writeFile(`${root}/pi-rpc-smoke.json`, JSON.stringify(JSON.parse(output.trim()), null, 2));
}
const evidence: Record<string, unknown> = {};
for (const name of ["real-e2e", "response-quality", "ui-smoke", "web/mcp-check", "web/real-e2e", "web/ui-smoke"]) {
  try {
    const record = JSON.parse(await readFile(`${root}/${name}.json`, "utf8"));
    evidence[name] = { executedAt: record.executedAt, total: record.total, passed: record.passed, failed: record.failed, mode: record.mode, path: `${root}/${name}.json` };
  } catch { evidence[name] = { status: "NOT_EXECUTED", path: `${root}/${name}.json` }; }
}
await writeFile(`${root}/audit-run.json`, JSON.stringify({ executedAt: new Date().toISOString(), environment: { node: process.version, platform: process.platform, architecture: process.arch }, runs, evidence, note: "Saved real evidence timestamps are separate from this audit. Use --real/--ui for Coding runs and --web/--web-ui for web runs; the default only evaluates saved real responses." }, null, 2) + "\n");
if (runs.some((run) => run.exitCode !== 0)) process.exitCode = 1;
