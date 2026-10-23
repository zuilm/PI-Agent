import test, { after } from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../src/server.js";
import { MemorySandboxProvider } from "../src/sandbox/provider.js";
import { ReplayPi } from "./helpers.js";

const replayClients: ReplayPi[] = [];
const { app, sessions, artifacts } = await buildApp({ logger: false, sandboxFactory: () => new MemorySandboxProvider(), piFactory: () => { const pi = new ReplayPi(); replayClients.push(pi); return pi; } });
after(async () => app.close());
async function createSession(): Promise<string> {
  const response = await app.inject({ method: "POST", url: "/api/sessions", payload: {} }); assert.equal(response.statusCode, 200); return response.json().sessionId;
}
async function upload(sessionId: string, content: string, filename = "numbers.txt") {
  const boundary = `boundary-${crypto.randomUUID()}`;
  return app.inject({ method: "POST", url: `/api/sessions/${sessionId}/files`, headers: { "content-type": `multipart/form-data; boundary=${boundary}` }, payload: Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: text/plain\r\n\r\n${content}\r\n--${boundary}--\r\n`) });
}
test("health reports Pi as the runtime", async () => {
  const response = await app.inject({ method: "GET", url: "/api/health" }); assert.equal(response.statusCode, 200); assert.equal(response.json().agent, "pi-rpc");
});
test("frontend entry loads only the packaged CSS and JavaScript assets", async () => {
  const page = await app.inject({ method: "GET", url: "/" });
  assert.equal(page.statusCode, 200);
  for (const [asset, type] of [["app.css", "text/css"], ["app.js", "text/javascript"]]) {
    assert.ok(page.body.includes(`/assets/${asset}`));
    const response = await app.inject({ method: "GET", url: `/assets/${asset}` });
    assert.equal(response.statusCode, 200); assert.ok(String(response.headers["content-type"]).startsWith(type)); assert.ok(response.body.length > 100);
  }
  assert.equal((await app.inject({ method: "GET", url: "/assets/.env" })).statusCode, 404);
});
test("unknown sessions return 404", async () => assert.equal((await app.inject({ method: "GET", url: "/api/sessions/missing" })).statusCode, 404));
test("session state never exposes bridge authorization token", async () => {
  const sessionId = await createSession(); const response = await app.inject({ method: "GET", url: `/api/sessions/${sessionId}` });
  assert.equal(response.json().status, "idle"); assert.equal(response.body.includes(sessions.get(sessionId)!.bridgeToken), false);
});
test("upload returns sandbox paths and retains exact input bytes", async () => {
  const sessionId = await createSession(); const response = await upload(sessionId, "3,1\n2");
  assert.equal(response.statusCode, 200); assert.deepEqual(response.json().paths, ["/workspace/input/numbers.txt"]);
  assert.equal(new TextDecoder().decode(await sessions.get(sessionId)!.sandbox.read(response.json().lastInputPath)), "3,1\n2");
});
test("same-name files in different sessions remain isolated", async () => {
  const a = await createSession(); const b = await createSession(); await upload(a, "3 1"); await upload(b, "9 7");
  assert.equal(new TextDecoder().decode(await sessions.get(a)!.sandbox.read("/workspace/input/numbers.txt")), "3 1");
  assert.equal(new TextDecoder().decode(await sessions.get(b)!.sandbox.read("/workspace/input/numbers.txt")), "9 7");
});
test("multipart files over 10 MiB are rejected without updating input state", async () => {
  const sessionId = await createSession(); const response = await upload(sessionId, "1".repeat(10 * 1024 * 1024 + 1));
  assert.equal(response.statusCode, 413); assert.equal(sessions.get(sessionId)!.state.lastInputPath, undefined);
});
test("empty and non-string prompts are rejected before Pi is invoked", async () => {
  const sessionId = await createSession(); const pi = sessions.get(sessionId)!.pi as ReplayPi;
  for (const message of ["", "  ", 3, {}, null]) assert.equal((await app.inject({ method: "POST", url: `/api/sessions/${sessionId}/prompts`, payload: { message } })).statusCode, 400);
  assert.equal(pi.commands.length, 0);
});
test("general prompts without files are accepted and passed to Pi", async () => {
  const sessionId = await createSession(); const response = await app.inject({ method: "POST", url: `/api/sessions/${sessionId}/prompts`, payload: { message: "编写斐波那契程序" } });
  assert.equal(response.statusCode, 202); await sessions.get(sessionId)!.running;
  const pi = sessions.get(sessionId)!.pi as ReplayPi; assert.ok(pi.commands[0].message.endsWith("编写斐波那契程序")); assert.equal(sessions.get(sessionId)!.state.status, "idle");
});
test("running sessions reject further prompts and uploads", async () => {
  const sessionId = await createSession(); const entry = sessions.get(sessionId)!; entry.state.status = "running";
  assert.equal((await app.inject({ method: "POST", url: `/api/sessions/${sessionId}/prompts`, payload: { message: "test" } })).statusCode, 409);
  assert.equal((await upload(sessionId, "1")).statusCode, 409); entry.state.status = "idle";
});
test("bridge rejects missing and incorrect tokens", async () => {
  const sessionId = await createSession(); for (const token of ["", "incorrect"]) assert.equal((await app.inject({ method: "POST", url: `/internal/sessions/${sessionId}/tools`, headers: { authorization: `Bearer ${token}` }, payload: { operation: "read", args: {} } })).statusCode, 403);
});
test("bridge tokens are scoped to their own sessions", async () => {
  const a = await createSession(); const b = await createSession();
  const response = await app.inject({ method: "POST", url: `/internal/sessions/${b}/tools`, headers: { authorization: `Bearer ${sessions.get(a)!.bridgeToken}` }, payload: { operation: "read", args: {} } }); assert.equal(response.statusCode, 403);
});
test("bridge denies requests outside an active run", async () => {
  const sessionId = await createSession(); const response = await app.inject({ method: "POST", url: `/internal/sessions/${sessionId}/tools`, headers: { authorization: `Bearer ${sessions.get(sessionId)!.bridgeToken}` }, payload: { operation: "read", args: {} } }); assert.equal(response.statusCode, 409);
});
test("authorized active bridge requests can read sandbox data", async () => {
  const sessionId = await createSession(); await upload(sessionId, "3 1"); const entry = sessions.get(sessionId)!; entry.state.status = "running"; entry.runId = "replay";
  const response = await app.inject({ method: "POST", url: `/internal/sessions/${sessionId}/tools`, headers: { authorization: `Bearer ${entry.bridgeToken}` }, payload: { operation: "read", args: { path: "/workspace/input/numbers.txt" } } });
  assert.equal(response.statusCode, 200); assert.equal(Buffer.from(response.json().data, "base64").toString(), "3 1"); entry.state.status = "idle"; entry.runId = undefined;
});
test("artifact downloads enforce session ownership and allow text preview", async () => {
  const sessionId = await createSession(); const entry = sessions.get(sessionId)!; await entry.sandbox.upload("/workspace/output/a.txt", Buffer.from("hello"));
  const artifact = await artifacts.register(sessionId, entry.sandbox, "/workspace/output/a.txt");
  assert.equal((await app.inject({ method: "GET", url: `/api/artifacts/${artifact.artifactId}?sessionId=other` })).statusCode, 403);
  const response = await app.inject({ method: "GET", url: `/api/artifacts/${artifact.artifactId}?sessionId=${sessionId}&preview=1` });
  assert.equal(response.body, "hello"); assert.match(String(response.headers["content-disposition"]), /^inline;/);
});
test("event IDs increase and real Pi source labels are preserved in API state", async () => {
  const sessionId = await createSession(); await app.inject({ method: "POST", url: `/api/sessions/${sessionId}/prompts`, payload: { message: "hello" } }); await sessions.get(sessionId)!.running;
  const events = sessions.get(sessionId)!.state.eventLog; assert.ok(events.every((e, i) => e.eventId === i + 1)); assert.ok(events.some((e) => e.type === "assistant_message" && e.source === "pi-model"));
});
test("files created by Pi are discovered before completion without an explicit publish call", async () => {
  const sessionId = await createSession(); const entry = sessions.get(sessionId)!;
  (entry.pi as ReplayPi).respond = async (_command, replay) => {
    await entry.sandbox.upload("/workspace/output/custom.txt", Buffer.from("created by the replayed remote tool"));
    replay.emit({ type: "agent_settled" }); return { success: true };
  };
  await app.inject({ method: "POST", url: `/api/sessions/${sessionId}/prompts`, payload: { message: "create a custom file" } }); await entry.running;
  assert.equal(entry.state.artifacts[0].filename, "custom.txt");
  assert.ok(entry.state.eventLog.findIndex((e) => e.type === "artifact_ready") < entry.state.eventLog.findIndex((e) => e.type === "run_settled"));
});
test("API cancellation stops a pending Pi run", async () => {
  const sessionId = await createSession(); const entry = sessions.get(sessionId)!; (entry.pi as ReplayPi).respond = async () => ({ success: true });
  await app.inject({ method: "POST", url: `/api/sessions/${sessionId}/prompts`, payload: { message: "slow task" } });
  const response = await app.inject({ method: "POST", url: `/api/sessions/${sessionId}/abort` }); assert.equal(response.statusCode, 200); assert.equal(response.json().status, "failed"); assert.ok(entry.state.eventLog.some((e) => e.type === "run_settled" && e.aborted));
});
test("server close disposes all Pi and sandbox resources", async () => {
  const instance = await buildApp({ logger: false, sandboxFactory: () => new MemorySandboxProvider(), piFactory: () => new ReplayPi() });
  const created = await instance.app.inject({ method: "POST", url: "/api/sessions", payload: {} });
  const entry = instance.sessions.get(created.json().sessionId)!; const pi = entry.pi as ReplayPi;
  await instance.app.close(); assert.equal(pi.stopped, true); assert.equal(instance.sessions.size, 0);
});
test("SSE reconnect replays only records after Last-Event-ID", async () => {
  const instance = await buildApp({ logger: false, sandboxFactory: () => new MemorySandboxProvider(), piFactory: () => new ReplayPi() });
  let controller: AbortController | undefined;
  try {
    await instance.app.listen({ host: "127.0.0.1", port: 0 });
    const port = (instance.app.server.address() as { port: number }).port;
    const created = await instance.app.inject({ method: "POST", url: "/api/sessions", payload: {} }); const sessionId = created.json().sessionId;
    await instance.app.inject({ method: "POST", url: `/api/sessions/${sessionId}/prompts`, payload: { message: "test" } }); await instance.sessions.get(sessionId)!.running;
    const events = instance.sessions.get(sessionId)!.state.eventLog; const after = events[events.length - 2].eventId!;
    controller = new AbortController();
    const response = await fetch(`http://127.0.0.1:${port}/api/sessions/${sessionId}/events`, { headers: { "Last-Event-ID": String(after) }, signal: controller.signal });
    assert.match(response.headers.get("content-type")!, /text\/event-stream/);
    const result = await response.body!.getReader().read(); const data = new TextDecoder().decode(result.value);
    assert.match(data, new RegExp(`id: ${after + 1}\\n`)); assert.equal(data.includes(`id: ${after}\n`), false);
  } finally { controller?.abort(); await instance.app.close(); }
});
