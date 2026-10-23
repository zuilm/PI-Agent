import { createHash } from "node:crypto";
import { basename } from "node:path";
import type { ArtifactMeta } from "../types.js";
import type { SandboxProvider } from "../sandbox/provider.js";

const contentTypes: Record<string, string> = {
  ".txt": "text/plain; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".pdf": "application/pdf",
};

export class ArtifactStore {
  private data = new Map<string, Uint8Array>();
  private metadata = new Map<string, ArtifactMeta>();

  async register(sessionId: string, sandbox: SandboxProvider, path: string): Promise<ArtifactMeta> {
    const bytes = await sandbox.read(path);
    const filename = basename(path);
    const artifactId = `artifact_${crypto.randomUUID()}`;
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const existing = [...this.metadata.values()].find((meta) => meta.sessionId === sessionId && meta.path === path && meta.sha256 === sha256);
    if (existing) return existing;
    const ext = filename.includes(".") ? filename.slice(filename.lastIndexOf(".")).toLowerCase() : "";
    const meta: ArtifactMeta = {
      artifactId,
      sessionId,
      path,
      filename,
      contentType: contentTypes[ext] ?? "application/octet-stream",
      size: bytes.byteLength,
      sha256,
      createdAt: new Date().toISOString(),
    };
    this.data.set(artifactId, bytes);
    this.metadata.set(artifactId, meta);
    return meta;
  }

  get(artifactId: string): Uint8Array | undefined {
    return this.data.get(artifactId);
  }

  getMeta(artifactId: string): ArtifactMeta | undefined {
    return this.metadata.get(artifactId);
  }
}
