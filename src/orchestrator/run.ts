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
  runId?: string;
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
  const runId = opts.runId || new Date().toISOString().replace(/[:.]/g, "-");
  for (const stepId of order) {
    const step = opts.graph.steps[stepId];
    await runStep(step, { ...opts, runId });
  }
}

async function runInjectedSubgraph(sub: StepGraph, opts: RunOptions) {
  const order = topoSort(sub);
  for (const sid of order) {
    const s = sub.steps[sid];
    await runStep(s, opts);
  }
}

export async function runStep(step: StepContract, opts: RunOptions) {
  const { provider, tools, blackboard, model, runId } = opts;
  const toolDefs = toolDefsFromRegistry(tools);
  let messages = renderMetaprompt(step, blackboard);

  const proposals: Record<string, any> = {};

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

        if (runId) {
          try { writeJson(runId, step.step_id, `tool_${call.name}_${call.id}.json`, { args, result }); } catch {}
        }

        if (call.name === "workflow_inject_subgraph" && (result?.output as any)?.handle) {
          const h = (result.output as any).handle;
          proposals[h] = result.output;
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
    if (runId) {
      try { writeJson(runId, step.step_id, `outputs.json`, parsed); } catch {}
    }

    const handle = parsed?.subgraph_apply?.handle as string | undefined;
    if (handle) {
      const proposal = proposals[handle];
      if (!proposal) {
        if (runId) try { writeJson(runId, step.step_id, `workflow_apply_error_${handle}.json`, { error: "handle not found in proposals" }); } catch {}
      } else if (!proposal.approved) {
        if (runId) try { writeJson(runId, step.step_id, `workflow_apply_rejected_${handle}.json`, { issues: proposal.issues }); } catch {}
      } else {
        if (runId) try { writeJson(runId, step.step_id, `workflow_patch_${handle}.json`, { patch: proposal.patch, metadata: { reason: parsed?.reason || proposal?.reason } }); } catch {}
        const sub: StepGraph = proposal.compiled_subgraph as StepGraph;
        await runInjectedSubgraph(sub, opts);
      }
    }

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
