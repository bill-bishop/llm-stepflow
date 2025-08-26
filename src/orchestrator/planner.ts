import type { StepGraph } from "../types/contracts.js";

export function planFromObjective(objective: string): StepGraph {
  return {
    steps: {
      "define_scope": {
        step_id: "define_scope",
        executor: "intelligent",
        goal: "Clarify objective and produce a single-sentence scope.",
        inputs: { required: [], optional: [] },
        outputs_schema: { scope: "string" },
        determinism: "low",
        invariants: []
      }
    },
    edges: []
  };
}
