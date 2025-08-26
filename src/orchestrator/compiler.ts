import type { StepGraph } from "../types/contracts.js";

export function compileGraph(draft: StepGraph): StepGraph {
  // Minimal validation
  for (const [id, step] of Object.entries(draft.steps)) {
    if (id !== step.step_id) throw new Error(`step_id mismatch for ${id}`);
    if (!step.outputs_schema || Object.keys(step.outputs_schema).length === 0) {
      throw new Error(`outputs_schema missing for ${id}`);
    }
  }
  // TODO: expand workflow nodes from library if desired
  return draft;
}
