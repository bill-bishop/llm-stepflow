// src/tools/workflow/inject.ts
import type { ToolSpec } from "../../types/tools.js";
import type { StepGraph, StepContract } from "../../types/contracts.js";
import { compileGraph } from "../../orchestrator/compiler.js";

type AttachMode = "before" | "after" | "replace" | "fanout";

interface NodeLike {
  id?: string;
  step_id?: string;
  goal?: string;
  type?: string;   // e.g., web_search / cli_exec hint
  params?: Record<string, any>;
}

interface InjectArgs {
  reason: string;
  attach_point: { mode: AttachMode; anchor_step: string };
  subgraph: any; // accept loose shape; we will coerce
  limits?: { max_steps?: number; max_edges?: number };
  dry_run?: boolean;
  metadata?: { intent?: string; tags?: string[] };
}

function countSteps(g: StepGraph): number { return Object.keys(g.steps || {}).length; }
function countEdges(g: StepGraph): number { return (g.edges || []).length; }
function makeHandle(): string {
  const rnd = Math.random().toString(36).slice(2, 8);
  return `subgraph_${Date.now().toString(36)}_${rnd}`;
}
function snake(s: string): string {
  return (s || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

/** Coerce simplified { steps: NodeLike[], edges:[{from,to}] } into a valid StepGraph. */
function coerceToStepGraph(raw: any): StepGraph {
  const coerced: StepGraph = { steps: {}, edges: [] };
  if (!raw || typeof raw !== "object") return coerced;

  if (Array.isArray(raw.steps)) {
    for (let i = 0; i < raw.steps.length; i++) {
      const n = raw.steps[i] as NodeLike;
      const idRaw = n.step_id || n.id || `s${i}`;
      const id = snake(String(idRaw || `s${i}`)) || `s${i}`;
      const goal = n.goal || (n.type ? `Use ${n.type} with params to satisfy subtask ${id}.` : `Perform subtask ${id}.`);

      const step: StepContract = {
        step_id: id,
        executor: "intelligent" as any, // we tolerate 'string' at runtime; compileGraph will validate ExecutorType
        goal,
        inputs: { required: [], optional: [] },
        outputs_schema: { result: "string" },
        determinism: "low",
        invariants: []
      };
      coerced.steps[id] = step;
    }
  } else if (raw.steps && typeof raw.steps === "object") {
    // assume caller used proper StepGraph
    coerced.steps = raw.steps;
  }

  if (Array.isArray(raw.edges)) {
    for (const e of raw.edges) {
      if (e && typeof e.from === "string" && typeof e.to === "string") {
        coerced.edges.push({ from: snake(e.from), to: snake(e.to) });
      }
    }
  }
  return coerced;
}

export const workflowInjectSubgraph: ToolSpec = {
  name: "workflow_inject_subgraph",
  input_schema: {
    reason: "string — why a subflow is needed",
    attach_point: "{ mode:'before|after|replace|fanout', anchor_step:string }",
    subgraph: "StepGraph — {steps, edges}. Also accepts simplified {steps:[{id|step_id, goal, type?, params?}], edges:[{from,to}]}",
    limits: "{ max_steps?: number, max_edges?: number }",
    dry_run: "boolean (default true)",
    metadata: "{ intent?: string, tags?: string[] }"
  },
  output_schema: {
    approved: "boolean",
    issues: "string[]",
    compiled_subgraph: "StepGraph|null",
    patch: "object (attach patch proposal)",
    handle: "string (proposal id)",
    metrics: "{ step_count:number, edge_count:number }"
  },
  async invoke(args) {
    try {
      const a = args as unknown as InjectArgs;
      const issues: string[] = [];
      if (!a || typeof a !== "object") return { name: this.name, ok: false, output: {}, error: "Invalid args" };

      if (!a.reason || typeof a.reason !== "string") issues.push("reason missing");
      const ap = a.attach_point as any;
      const mode = ap?.mode as AttachMode;
      const anchor = ap?.anchor_step as string;
      if (!mode || !anchor) issues.push("attach_point.mode and attach_point.anchor_step required");

      // Accept loose subgraph and coerce into a StepGraph
      const rawSub = a.subgraph as any;
      let sg: StepGraph = coerceToStepGraph(rawSub);

      // Compile to normalize & check basics
      let compiled: StepGraph | null = null;
      if (!issues.length) {
        try {
          compiled = compileGraph(sg);
        } catch (e: any) {
          issues.push(`compileGraph failed: ${e?.message || e}`);
        }
      }

      const metrics = { step_count: compiled ? countSteps(compiled) : 0, edge_count: compiled ? countEdges(compiled) : 0 };
      const maxSteps = a.limits?.max_steps ?? 8;
      const maxEdges = a.limits?.max_edges ?? 24;
      if (metrics.step_count > maxSteps) issues.push(`too many steps: ${metrics.step_count} > ${maxSteps}`);
      if (metrics.edge_count > maxEdges) issues.push(`too many edges: ${metrics.edge_count} > ${maxEdges}`);

      const handle = makeHandle();
      const patch = {
        op: "attach",
        mode,
        anchor_step: anchor,
        steps: compiled?.steps || {},
        edges: compiled?.edges || []
      };

      const approved = issues.length === 0;
      return {
        name: this.name,
        ok: true,
        output: { approved, issues, compiled_subgraph: compiled, patch, handle, metrics }
      };
    } catch (e: any) {
      return { name: this.name, ok: false, output: {}, error: String(e?.message || e) };
    }
  }
};
