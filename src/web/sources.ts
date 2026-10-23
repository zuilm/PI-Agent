import type { WebSource } from "../types.js";

export function fetchedSource(result: unknown, accessedAt: string): WebSource | undefined {
  if (!result || typeof result !== "object") return;
  const record = result as Record<string, any>;
  if (record.isError) return;
  const payloads = [record.structuredContent, ...(Array.isArray(record.content) ? record.content.filter((block: any) => block.type === "text").map((block: any) => {
    try { return JSON.parse(block.text); } catch { return undefined; }
  }) : [])];
  for (const data of payloads) {
    if (!data || typeof data !== "object" || data.error || data.fetch_failed || Number(data.http_status) >= 400 || typeof data.markdown !== "string" || !data.markdown.trim()) continue;
    let url: URL;
    try { url = new URL(data.url); } catch { continue; }
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) continue;
    return { url: url.href, title: typeof data.title === "string" ? data.title : url.hostname, domain: url.hostname,
      accessedAt, cached: data.cached === true, characters: data.markdown.length,
      ...(typeof data.content_hash === "string" ? { contentHash: data.content_hash } : {}),
      ...(typeof data.http_status === "number" ? { httpStatus: data.http_status } : {}),
    };
  }
}
