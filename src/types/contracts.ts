export type StepId = string;

export type ExecutorType = "intelligent" | "procedural" | "workflow";

export interface StepContract {
  step_id: StepId;
  executor: ExecutorType;
  goal: string;
  inputs: {
    required: string[];
    optional?: string[];
  };
  outputs_schema: Record<string, string>;
  determinism: "low" | "high";
  invariants?: string[];
  tool_budget?: { tokens?: number; calls?: number; wall_time_s?: number };
  failure_policy?: { retries?: number; on_fail?: "emit_remediation" | "halt" };
  allowed_branch_intents?: string[];
}

export interface StepGraph {
  steps: Record<StepId, StepContract>;
  edges: Array<{ from: StepId; to: StepId }>;
}
