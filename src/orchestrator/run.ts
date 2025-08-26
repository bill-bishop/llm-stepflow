import type { StepGraph, StepContract } from "../types/contracts.js";
import type { ToolDefForLLM } from "../types/llm.js";
import type { ToolRegistry } from "../types/tools.js";
import type { LLMProvider } from "../llm/provider.js";
import { renderMetaprompt } from "../prompt/renderer.js";
import { write, read, type Blackboard } from "../blackboard/index.js";
import { topoSort } from "./topo.js";
import { verifyInvariants } from "./verify.js";
import { branchFactory } from "./branchFactory.js";

export interface RunOptions {
  provider: LLMProvider;
  tools: ToolRegistry;
  graph: StepGraph;
  blackboard: Blackboard;
  model: string;
  maxIterationsPerStep?: number;
}

function toolDefsFromRegistry(reg: ToolRegistry): ToolDefForLLM[] {
  return Object.values(reg).map(t => ({
    name: t.name,
    description: `Adapter for ${t.name}`,
    parameters: {
      type: "object",
      properties: Object.fromEntries(Object.entries(t.input_schema).map(([k, v]) => [k, { description: v }]))
    }
  }));
}

export async function runGraph(opts: RunOptions) {
  const order = topoSort(opts.graph);
  for (const stepId of order) {
    const step = opts.graph.steps[stepId];
    await runStep(step, opts);
  }
}

export async function runStep(step: StepContract, opts: RunOptions) {
  const { provider, tools, blackboard, model } = opts;
  const toolDefs = toolDefsFromRegistry(tools);
  let messages = renderMetaprompt(step, blackboard);

  for (let i = 0; i < (opts.maxIterationsPerStep ?? 6); i++) {
    const out = await provider.complete({
      model,
      messages,
      tools: toolDefs,
      tool_choice: "auto",
      temperature: 0.2,
      response_format: { type: "json_object" },
      max_tokens: 800
    });

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
        messages.push({
          role: "tool",
          name: call.name,
          tool_call_id: call.id,
          content: JSON.stringify(result)
        });
      }
      continue; // loop again; LLM now sees tool results
    }

    let parsed: any;
    try { parsed = JSON.parse(out.content || "{}"); }
    catch {
      messages.push({ role: "assistant", content: out.content ?? "" });
      messages.push({ role: "user", content: "Re-emit outputs as strict JSON only, no prose." });
      continue;
    }

    for (const field of Object.keys(step.outputs_schema)) {
      if (parsed[field] !== undefined) {
        write(blackboard, `${step.step_id}.${field}`, parsed[field]);
      }
    }

    const verdict = verifyInvariants(step, blackboard);
    if (!verdict.pass) {
      const sub = branchFactory(verdict.intent || "", step, blackboard);
      if (Object.keys(sub.steps).length > 0) {
        // naive: run subgraph immediately
        for (const subId of Object.keys(sub.steps)) {
          await runStep(sub.steps[subId], { ...opts });
        }
      }
    }
    return;
  }
  throw new Error(`Exceeded max iterations for step ${step.step_id}`);
}
