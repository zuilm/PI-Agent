import { createHash } from "node:crypto";
import { parseNumbers, type SandboxProvider } from "./provider.js";
import type { ValidationReport } from "../types.js";

export async function validateSortedNumbers(
  sandbox: SandboxProvider,
  inputPath: string,
  outputPath: string,
): Promise<ValidationReport> {
  const input = parseNumbers(new TextDecoder().decode(await sandbox.read(inputPath)));
  const output = parseNumbers(new TextDecoder().decode(await sandbox.read(outputPath)));
  const counts = (values: number[]) => {
    const map = new Map<number, number>();
    for (const value of values) map.set(value, (map.get(value) ?? 0) + 1);
    return map;
  };
  const inputCounts = counts(input);
  const outputCounts = counts(output);
  const ascending = output.every((value, i) => i === 0 || output[i - 1] <= value);
  const sameMultiset = input.length === output.length && [...inputCounts].every(([value, count]) => outputCounts.get(value) === count);
  const checks = [
    { name: "input_readable", ok: input.length > 0, details: `count=${input.length}` },
    { name: "output_readable", ok: output.length > 0, details: `count=${output.length}` },
    { name: "ascending", ok: ascending },
    { name: "count_preserved", ok: input.length === output.length, details: `${input.length} -> ${output.length}` },
    { name: "multiset_preserved", ok: sameMultiset },
  ];
  return {
    kind: "number-sort",
    ok: checks.every((check) => check.ok),
    checks,
    summary: {
      count: output.length,
      min: output.reduce((a, b) => Math.min(a, b)),
      max: output.reduce((a, b) => Math.max(a, b)),
      first10: output.slice(0, 10),
      last10: output.slice(-10),
      inputSha256: createHash("sha256").update(await sandbox.read(inputPath)).digest("hex"),
      outputSha256: createHash("sha256").update(await sandbox.read(outputPath)).digest("hex"),
    },
  };
}

export async function validateMultiplesOf7(sandbox: SandboxProvider, sourcePath: string, outputPath: string): Promise<ValidationReport> {
  const source = parseNumbers(new TextDecoder().decode(await sandbox.read(sourcePath)));
  const outputText = new TextDecoder().decode(await sandbox.read(outputPath));
  const output = outputText.trim() ? parseNumbers(outputText) : [];
  const expected = source.filter((value) => value % 7 === 0).sort((a, b) => b - a);
  const same = expected.length === output.length && expected.every((value, index) => value === output[index]);
  const descending = output.every((value, i) => i === 0 || output[i - 1] >= value);
  const checks = [
    { name: "all_divisible_by_7", ok: output.every((value) => value % 7 === 0) },
    { name: "descending", ok: descending },
    { name: "matches_expected_filter", ok: same },
  ];
  return { kind: "multiples-of-7", ok: checks.every((check) => check.ok), checks, summary: { count: output.length, first10: output.slice(0, 10), last10: output.slice(-10) } };
}
