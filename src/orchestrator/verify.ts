import type { StepContract } from "../types/contracts.js";
import type { Blackboard } from "../blackboard/index.js";

export interface Verdict {
  pass: boolean;
  intent?: string;
  reason?: string;
}

export function verifyInvariants(_step: StepContract, _bb: Blackboard): Verdict {
  // Minimal no-op verifier so the simplest flows don't branch
  return { pass: true };
}
