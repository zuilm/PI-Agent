import "dotenv/config";
import { mkdir, writeFile } from "node:fs/promises";
import { buildApp } from "../../src/server.js";

const { app, sessions } = await buildApp({ logger: false, runTimeoutMs: 120_000 });
try {
  await app.listen({ host: "127.0.0.1", port: 0 });
  const sessionReply = await app.inject({ method: "POST", url: "/api/sessions", payload: {} });
  if (sessionReply.statusCode !== 200) throw new Error(sessionReply.body);
  const sessionId = sessionReply.json().sessionId;
  await app.inject({ method: "POST", url: `/api/sessions/${sessionId}/prompts`, payload: { message: "请实际调用 bash 工具运行 printf 'PI_E2B_CONNECTED\\n'，然后用一句中文汇报执行结果。不要创建文件。" } });
  await sessions.get(sessionId)!.running;
  const state = sessions.get(sessionId)!.state;
  await mkdir("docs/evidence/current", { recursive: true });
  await writeFile("docs/evidence/current/pi-model-probe.json", JSON.stringify(state, null, 2));
  console.log(JSON.stringify({ status: state.status, events: state.eventLog, traceTypes: [...new Set(state.piTrace.map((e) => e.type))], stderr: (sessions.get(sessionId)!.pi as any).getStderr?.() }, null, 2));
  if (state.status !== "idle" || !state.eventLog.some((e) => e.type === "tool_finished" && e.name === "bash" && e.status === "ok")) process.exitCode = 1;
} finally { await app.close(); }
