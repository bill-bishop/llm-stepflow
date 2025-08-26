import { saveArtifact } from "../blackboard/fsStore.js";

export function writeJson(runId: string, stepId: string, name: string, obj: unknown) {
  const path = saveArtifact(runId, stepId, name, JSON.stringify(obj, null, 2));
  return path;
}
