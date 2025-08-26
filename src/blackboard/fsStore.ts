import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export function saveArtifact(runId: string, stepId: string, fileName: string, content: string) {
  const dir = join("runs", runId, stepId);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, fileName);
  writeFileSync(path, content, "utf-8");
  return path;
}
