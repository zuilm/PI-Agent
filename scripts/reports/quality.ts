import { readFile, writeFile } from "node:fs/promises";

const evidence = JSON.parse(await readFile("docs/evidence/current/real-e2e.json", "utf8")) as { results: Array<Record<string, any>> };
const samples = evidence.results.map((run) => {
  const events = run.events as Array<Record<string, any>>;
  const published = events.filter((e) => e.type === "artifact_ready");
  const observedLineCounts = events.filter((e) => e.type === "tool_started" && /\bwc\s+-l\b/.test(e.args?.command ?? "")).flatMap((start) => {
    const end = events.find((e) => e.type === "tool_finished" && e.toolCallId === start.toolCallId);
    const output = end?.result?.structuredContent?.output ?? "";
    const match = output.match(/^\s*(\d+)\s+\/workspace\/input\//m);
    return match ? [Number(match[1])] : [];
  });
  const claimedLineCounts = [...String(run.answer ?? "").matchAll(/共\s*\*{0,2}\s*([\d,，]+)\s*行/g)].map((match) => Number(match[1].replace(/[,，]/g, "")));
  const checks = {
    golden_output: run.passed === true,
    answer_present: Boolean(run.answer?.trim()),
    downloadable_files: published.length > 0 && published.every((e) => run.answer.includes(e.artifact.filename)),
    execution_evidence: events.some((e) => e.type === "tool_finished" && e.status === "ok") && events.some((e) => e.type === "validation_finished" && e.report.ok),
    model_source: events.filter((e) => e.type === "assistant_message").every((e) => e.source === "pi-model") && run.piTrace.some((e: Record<string, any>) => e.type === "agent_settled"),
    requested_language: /[\u4e00-\u9fff]/.test(run.answer ?? ""),
    observed_line_count_consistency: claimedLineCounts.length && observedLineCounts.length ? claimedLineCounts.every((count) => observedLineCounts.includes(count)) : null,
  };
  return { id: run.id, mode: "real-model/pi.exe/E2B/HTTP", prompt: run.prompt, answer: run.answer, checks, facts: { observedLineCounts, claimedLineCounts }, score: Object.values(checks).filter((value) => value === true).length, maximum: Object.values(checks).filter((value) => value !== null).length, passed: Object.values(checks).every((value) => value !== false) };
});
const result = { executedAt: new Date().toISOString(), modelEvaluation: "EXECUTED: actual Pi model responses with tool/HTTP/file evidence", rubric: "6 general binary dimensions plus optional consistency between a claimed input line count and actual wc -l output; all applicable checks must pass, null is N/A. This targeted consistency rule does not verify every claim. Language check only detects Chinese characters, not full style. Web citations N/A. One run per task is not a reliability estimate.", total: samples.length, passed: samples.filter((s) => s.passed).length, failed: samples.filter((s) => !s.passed).length, samples };
await writeFile("docs/evidence/current/response-quality.json", JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
if (result.failed) process.exitCode = 1;
