import type { StepGraph, StepContract } from "../types/contracts.js";
import type { ToolDefForLLM } from "../types/llm.js";
import type { ToolRegistry } from "../types/tools.js";
import type { LLMProvider } from "../llm/provider.js";
import { renderMetaprompt } from "../prompt/renderer.js";
import { write, type Blackboard } from "../blackboard/index.js";
import { topoSort } from "./topo.js";
import { verifyInvariants } from "./verify.js";
import { branchFactory } from "./branchFactory.js";
import { writeJson } from "./materialize.js";

export interface RunOptions {
  provider: LLMProvider;
  tools: ToolRegistry;
  graph: StepGraph;
  blackboard: Blackboard;
  model: string;
  maxIterationsPerStep?: number;
  runId?: string; // NEW: persistent artifacts under runs/{runId}/{step}/
}

function toolDefsFromRegistry(reg: ToolRegistry): ToolDefForLLM[] {
  return Object.values(reg).map(t => ({
    name: t.name, // NOTE: names must already match ^[a-zA-Z0-9_-]+$
    description: `Adapter for ${t.name}`,
    parameters: {
      type: "object",
      properties: Object.fromEntries(Object.entries(t.input_schema).map(([k, v]) => [k, { description: v }]))
    }
  }));
}

export async function runGraph(opts: RunOptions) {
  const order = topoSort(opts.graph);
  const runId = opts.runId || new Date().toISOString().replace(/[:.]/g, "-");
  for (const stepId of order) {
    const step = opts.graph.steps[stepId];
    await runStep(step, { ...opts, runId });
  }
}

export async function runStep(step: StepContract, opts: RunOptions) {
  const { provider, tools, blackboard, model, runId } = opts;
  const toolDefs = toolDefsFromRegistry(tools);
  let messages = renderMetaprompt(step, blackboard);

  for (let i = 0; i < (opts.maxIterationsPerStep ?? 6); i++) {
    const llmArgs = {
      model,
      messages,
      tools: toolDefs,
      tool_choice: "auto",
      temperature: 0.2,
      response_format: { type: "json_object" },
      max_tokens: 800
    } as const;

    const out = await provider.complete(llmArgs);

    // Persist request/response per iteration
    if (runId) {
      try {
        writeJson(runId, step.step_id, `iter_${i}_request.json`, { messages, llmArgs });
        writeJson(runId, step.step_id, `iter_${i}_response.json`, out);
      } catch {}
    }

    if (out.tool_calls?.length) {
      for (const call of out.tool_calls) {
        const spec = tools[call.name];
        if (!spec) {
          messages.push({ role: "assistant", content: `Requested unknown tool: ${call.name}` });
          continue;
        }
        let args: any = {};
        try { args = JSON.parse(call.arguments || "{}"); } catch {}
        const result = await spec.invoke(args);

        // Persist each tool call/return
        if (runId) {
          try { writeJson(runId, step.step_id, `tool_${call.name}_${call.id}.json`, { args, result }); } catch {}
        }

        messages.push({
          role: "tool",
          name: call.name,
          tool_call_id: call.id,
          content: JSON.stringify(result)
        });
      }
      continue;
    }

    // Expect strict JSON outputs
    let parsed: any;
    try { parsed = JSON.parse(out.content || "{}"); }
    catch {
      messages.push({ role: "assistant", content: out.content ?? "" });
      messages.push({ role: "user", content: "Re-emit outputs as strict JSON only, no prose." });
      continue;
    }

    // Write declared outputs to blackboard
    for (const field of Object.keys(step.outputs_schema)) {
      if (parsed[field] !== undefined) {
        write(blackboard, `${step.step_id}.${field}`, parsed[field]);
      }
    }
    if (runId) {
      try { writeJson(runId, step.step_id, `outputs.json`, parsed); } catch {}
    }

    // Verify & optional branching
    const verdict = verifyInvariants(step, blackboard);
    if (!verdict.pass) {
      const sub = branchFactory(verdict.intent || "", step, blackboard);
      if (Object.keys(sub.steps).length > 0) {
        for (const subId of Object.keys(sub.steps)) {
          await runStep(sub.steps[subId], { ...opts });
        }
      }
    }
    return;
  }
  throw new Error(`Exceeded max iterations for step ${step.step_id}`);
}
