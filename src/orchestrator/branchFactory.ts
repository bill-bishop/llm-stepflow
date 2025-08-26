import type { StepGraph, StepContract } from "../types/contracts.js";
import type { Blackboard } from "../blackboard/index.js";

export function branchFactory(intent: string, atStep: StepContract, _bb: Blackboard): StepGraph {
  switch (intent) {
    case "deepen_search":
      return {
        steps: {
          "search_more": {
            step_id: "search_more",
            executor: "intelligent",
            goal: "Find additional high-quality sources to raise confidence.",
            inputs: { required: [ `${atStep.step_id}.notes` ], optional: ["workflow_definition"] },
            outputs_schema: { sources: "string[]", confidence: "number", notes: "string" },
            determinism: "low",
            invariants: ["len(sources)>=3","confidence>=0.75"]
          }
        },
        edges: []
      };
    default:
      return { steps: {}, edges: [] };
  }
}
