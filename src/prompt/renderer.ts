import type { Message } from "../types/llm.js";
import type { StepContract } from "../types/contracts.js";
import type { Blackboard } from "../blackboard/index.js";
import { read } from "../blackboard/index.js";

export function renderMetaprompt(step: StepContract, blackboard: Blackboard): Message[] {
  const sys: Message = {
    role: "system",
    content: [
      `You are a precise agent executing step_id=${step.step_id}.`,
      `Goal: ${step.goal}`,
      `You MUST satisfy invariants: ${(step.invariants || []).join("; ") || "none"}`,
      `Output strictly as JSON matching outputs_schema keys: ${Object.keys(step.outputs_schema).join(", ")}`
    ].join("\n")
  };

  const inputLines: string[] = [];
  const allInputs = (step.inputs.required || []).concat(step.inputs.optional || []);
  for (const key of allInputs) {
    const val = read(blackboard, key);
    inputLines.push(`- ${key}: ${val !== undefined ? JSON.stringify(val) : "<MISSING>"}`);
  }

  const user: Message = {
    role: "user",
    content: [
      "INPUTS:",
      ...inputLines,
      "",
      "INSTRUCTIONS:",
      "- If you need external info, propose tool calls via function-calling.",
      "- Otherwise, return JSON with exactly the required fields.",
      "",
      "SCHEMA HINTS:",
      JSON.stringify(step.outputs_schema, null, 2)
    ].join("\n")
  };

  return [sys, user];
}
