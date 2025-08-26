// src/orchestrator/run.ts
// Adds descriptive phase labels for each iteration ("iter # — …") alongside step logging.
// Env flags:
//   LOG_STEPS=1 (default)  → print step start/iter/done
//   LOG_TOOLS=0 (default)  → set to 1 to print tool calls
//   QUIET=1                → suppress all logging

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
  maxToolExecPerStep?: number; // default 6
}

const COLOR = {
  reset: "\x1b[0m",
  gray: (s: string) => `\x1b[90m${s}${COLOR.reset}`,
  cyan: (s: string) => `\x1b[36m${s}${COLOR.reset}`,
  green: (s: string) => `\x1b[32m${s}${COLOR.reset}`,
  yellow: (s: string) => `\x1b[33m${s}${COLOR.reset}`,
  magenta: (s: string) => `\x1b[35m${s}${COLOR.reset}`,
};

const QUIET = process.env.QUIET === "1";
const LOG_STEPS = !QUIET && (process.env.LOG_STEPS ?? "1") !== "0";
const LOG_TOOLS = !QUIET && (process.env.LOG_TOOLS ?? "0") === "1";

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
  let idx = 0;
  for (const stepId of order) {
    const step = opts.graph.steps[stepId];
    if (LOG_STEPS) {
      const goal = (step.goal || "").slice(0, 96);
      console.log(`\n${COLOR.cyan("▶ step")} ${++idx}/${order.length} ${stepId} ${goal ? COLOR.gray("— " + goal) : ""}`);
    }
    await runStep(step, { ...opts, runId });
    if (LOG_STEPS) console.log(`${COLOR.green("✓ done")} ${stepId}`);
  }
}

export async function runStep(step: StepContract, opts: RunOptions) {
  const { provider, tools, blackboard, model, runId } = opts;
  const toolDefs = toolDefsFromRegistry(tools);
  let messages = renderMetaprompt(step, blackboard);

  // Cache of tool-call results within this step to prevent loops
  const seenCalls = new Map<string, any>();
  let toolExecCount = 0;
  const maxToolExec = opts.maxToolExecPerStep ?? 6;

  for (let i = 0; i < (opts.maxIterationsPerStep ?? 8); i++) {
    if (LOG_STEPS) console.log(COLOR.gray(`  iter ${i + 1} — thinking`));

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
      if (LOG_STEPS) {
        const names = out.tool_calls.map(tc => tc.name).join(", ");
        console.log(COLOR.magenta(`  iter ${i + 1} — tool_call → ${names}`));
      }
      // Add the assistant message that requested the tools
      messages.push({
        // @ts-ignore passthrough
        role: "assistant",
        content: out.content ?? "",
        tool_calls: out.tool_calls.map(tc => ({
          id: tc.id,
          type: "function",
          function: { name: tc.name, arguments: tc.arguments || "{}" }
        }))
      } as any);

      for (const call of out.tool_calls) {
        const sig = `${call.name}::${call.arguments ?? ""}`;

        // Optional console logging for tools
        if (LOG_TOOLS) {
          let argsPreview = "";
          try { argsPreview = JSON.stringify(JSON.parse(call.arguments || "{}")); } catch { argsPreview = String(call.arguments || ""); }
          if (argsPreview.length > 140) argsPreview = argsPreview.slice(0, 140) + "…";
          console.log(COLOR.yellow(`    ↳ tool ${call.name}(${argsPreview})`));
        }

        // If we've executed this exact call before, replay cached result (no external exec)
        if (seenCalls.has(sig)) {
          const cached = seenCalls.get(sig);
          messages.push({
            role: "tool",
            name: call.name,
            tool_call_id: call.id,
            content: JSON.stringify({ ...cached, note: "reused_cached_result" })
          } as any);
          continue;
        }

        // Budget guard to prevent infinite loops
        if (toolExecCount >= maxToolExec) {
          const synthetic = {
            name: call.name,
            ok: false,
            error: "max_tool_exec_per_step_exceeded",
            output: {}
          };
          messages.push({
            role: "tool",
            name: call.name,
            tool_call_id: call.id,
            content: JSON.stringify(synthetic)
          } as any);
          continue;
        }

        // Execute tool
        const spec = tools[call.name];
        if (!spec) {
          const synthetic = { name: call.name, ok: false, error: "unknown_tool", output: {} };
          messages.push({ role: "tool", name: call.name, tool_call_id: call.id, content: JSON.stringify(synthetic) } as any);
          continue;
        }
        let args: any = {};
        try { args = JSON.parse(call.arguments || "{}"); } catch {}

        let result: any;
        try {
          result = await spec.invoke(args);
        } catch (e: any) {
          result = { name: call.name, ok: false, error: String(e?.message || e), output: {} };
        }
        toolExecCount++;
        seenCalls.set(sig, result);

        if (runId) {
          try { writeJson(runId, step.step_id, `tool_${call.name}_${call.id}.json`, { args, result }); } catch {}
        }

        messages.push({
          role: "tool",
          name: call.name,
          tool_call_id: call.id,
          content: JSON.stringify(result)
        } as any);
      }
      if (LOG_STEPS) console.log(COLOR.gray(`  iter ${i + 1} — consuming tool results`));
      // Let the model consume the tool results
      continue;
    }

    // Expect strict JSON outputs
    let parsed: any;
    try { parsed = JSON.parse(out.content || "{}"); }
    catch {
      if (LOG_STEPS) console.log(COLOR.gray(`  iter ${i + 1} — nudge: enforce JSON`));
      messages.push({ role: "assistant", content: out.content ?? "" });
      messages.push({ role: "user", content: "Return outputs as strict JSON only, no prose." });
      continue;
    }

    // Write declared outputs to blackboard
    const written: string[] = [];
    for (const field of Object.keys(step.outputs_schema)) {
      if (parsed[field] !== undefined) {
        write(blackboard, `${step.step_id}.${field}`, parsed[field]);
        written.push(field);
      }
    }
    if (runId) {
      try { writeJson(runId, step.step_id, `outputs.json`, parsed); } catch {}
    }
    if (LOG_STEPS && written.length) {
      console.log(COLOR.green(`  iter ${i + 1} — wrote: ${written.join(", ")}`));
    } else if (LOG_STEPS) {
      console.log(COLOR.green(`  iter ${i + 1} — wrote: (none)`));
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
