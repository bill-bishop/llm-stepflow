// src/orchestrator/run.ts
// Simplified orchestrator with:
// - tool-calling loop
// - per-iteration timing + phase labels
// - duplicate tool-call cache
// - tool-reply invariant guard
// - **output normalization**: JSON-like strings → parsed objects (env NORMALIZE_JSON_STRINGS)

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
  maxToolExecPerStep?: number;
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
const NORMALIZE = (process.env.NORMALIZE_JSON_STRINGS ?? "1") !== "0";

const fmtMs = (ms: number) => `${Math.round(ms)}ms`;

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

// Ensure that every assistant message with tool_calls has tool replies placed immediately after it.
function enforceToolReplyInvariant(messages: any[]) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m?.role === "assistant" && Array.isArray((m as any).tool_calls) && (m as any).tool_calls.length) {
      const ids = (m as any).tool_calls.map((tc: any) => tc.id);
      let j = i + 1;
      let ok = true;
      for (const id of ids) {
        const hasReply = messages[j]?.role === "tool" && (messages[j] as any).tool_call_id === id;
        if (!hasReply) { ok = false; break; }
        j++;
      }
      if (!ok) {
        const synthetic = ids.map((id: string) => ({
          role: "tool",
          name: "synth_missing_reply",
          tool_call_id: id,
          content: JSON.stringify({ name: "synth_missing_reply", ok: false, error: "missing_tool_result", output: {} })
        }));
        messages.splice(i + 1, 0, ...synthetic);
      }
      break;
    }
  }
}

export async function runGraph(opts: RunOptions) {
  const order = topoSort(opts.graph);
  const runId = opts.runId || new Date().toISOString().replace(/[:.]/g, "-");
  let idx = 0;
  for (const stepId of order) {
    const step = opts.graph.steps[stepId];
    const stepStart = Date.now();
    if (LOG_STEPS) {
      const goal = (step.goal || "").slice(0, 96);
      console.log(`\n${COLOR.cyan("▶ step")} ${++idx}/${order.length} ${stepId} ${goal ? COLOR.gray("— " + goal) : ""}`);
    }
    await runStep(step, { ...opts, runId });
    if (LOG_STEPS) {
      const stepMs = Date.now() - stepStart;
      console.log(`${COLOR.green("✓ done")} ${stepId} ${COLOR.gray("(" + fmtMs(stepMs) + ")")}`);
    }
  }
}

export async function runStep(step: StepContract, opts: RunOptions) {
  const { provider, tools, blackboard, model, runId } = opts;
  const toolDefs = toolDefsFromRegistry(tools);
  let messages = renderMetaprompt(step, blackboard);

  const seenCalls = new Map<string, any>();
  let toolExecCount = 0;
  const maxToolExec = opts.maxToolExecPerStep ?? 6;

  for (let i = 0; i < (opts.maxIterationsPerStep ?? 8); i++) {
    const iterStart = Date.now();
    if (LOG_STEPS) console.log(COLOR.gray(`  iter ${i + 1} — thinking`));

    // Guard: ensure previous iteration didn't leave an assistant tool_call without replies
    enforceToolReplyInvariant(messages);

    const llmArgs = {
      model,
      messages,
      tools: toolDefs,
      tool_choice: "auto",
      temperature: 0.2,
      response_format: { type: "json_object" },
      max_tokens: 800
    } as const;

    const t0 = Date.now();
    const out = await provider.complete(llmArgs);
    const thinkMs = Date.now() - t0;

    if (runId) {
      try {
        writeJson(runId, step.step_id, `iter_${i}_request.json`, { messages, llmArgs });
        writeJson(runId, step.step_id, `iter_${i}_response.json`, out);
      } catch {}
    }

    if (out.tool_calls?.length) {
      const names = out.tool_calls.map(tc => tc.name).join(", ");
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

      let toolsMsTotal = 0;

      for (const call of out.tool_calls) {
        const sig = `${call.name}::${call.arguments ?? ""}`;

        if (LOG_TOOLS) {
          let argsPreview = "";
          try { argsPreview = JSON.stringify(JSON.parse(call.arguments || "{}")); } catch { argsPreview = String(call.arguments || ""); }
          if (argsPreview.length > 140) argsPreview = argsPreview.slice(0, 140) + "…";
          process.stdout.write(COLOR.yellow(`    ↳ tool ${call.name}(${argsPreview}) `));
        }

        if (seenCalls.has(sig)) {
          const cached = seenCalls.get(sig);
          messages.push({
            role: "tool",
            name: call.name,
            tool_call_id: call.id,
            content: JSON.stringify({ ...cached, note: "reused_cached_result" })
          } as any);
          if (LOG_TOOLS) console.log(COLOR.gray(`[cache]`));
          continue;
        }

        if (toolExecCount >= maxToolExec) {
          const synthetic = { name: call.name, ok: false, error: "max_tool_exec_per_step_exceeded", output: {} };
          messages.push({ role: "tool", name: call.name, tool_call_id: call.id, content: JSON.stringify(synthetic) } as any);
          if (LOG_TOOLS) console.log(COLOR.gray(`[skipped: budget]`));
          continue;
        }

        const spec = tools[call.name];
        let result: any;
        if (!spec) {
          result = { name: call.name, ok: false, error: "unknown_tool", output: {} };
        } else {
          let args: any = {};
          try { args = JSON.parse(call.arguments || "{}"); } catch {}
          const tTool0 = Date.now();
          try { result = await spec.invoke(args); }
          catch (e: any) { result = { name: call.name, ok: false, error: String(e?.message || e), output: {} }; }
          const toolMs = Date.now() - tTool0;
          toolsMsTotal += toolMs;
          if (LOG_TOOLS) console.log(COLOR.gray(`[${fmtMs(toolMs)}]`));
        }

        toolExecCount++;
        seenCalls.set(sig, result);

        messages.push({
          role: "tool",
          name: call.name,
          tool_call_id: call.id,
          content: JSON.stringify(result)
        } as any);
      }

      const iterMs = Date.now() - iterStart;
      if (LOG_STEPS) console.log(COLOR.magenta(`  iter ${i + 1} — tool_call → ${names} ${COLOR.gray("(" + fmtMs(iterMs) + "; model " + fmtMs(thinkMs) + ", tools " + fmtMs(toolsMsTotal) + ")")}`));
      if (LOG_STEPS) console.log(COLOR.gray(`  iter ${i + 1} — consuming tool results`));
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

    // Optional normalization: convert JSON-like strings into objects
    let normalized = parsed;
    const normalizedFields: string[] = [];
    if (NORMALIZE) {
      normalized = { ...parsed };
      for (const [k, v] of Object.entries(parsed)) {
        if (typeof v === "string") {
          const s = v.trim();
          if ((s.startsWith("{") && s.endsWith("}")) || (s.startsWith("[") && s.endsWith("]"))) {
            try {
              normalized[k] = JSON.parse(s);
              normalizedFields.push(k);
            } catch {}
          }
        }
      }
    }

    // Persist outputs
    const written: string[] = [];
    for (const field of Object.keys(step.outputs_schema)) {
      const value = (normalized as any)[field];
      if (value !== undefined) {
        write(blackboard, `${step.step_id}.${field}`, value);
        written.push(field);
      }
    }
    if (runId) {
      try {
        if (NORMALIZE && normalizedFields.length) {
          writeJson(runId, step.step_id, `outputs_raw.json`, parsed);
        }
        writeJson(runId, step.step_id, `outputs.json`, NORMALIZE ? normalized : parsed);
      } catch {}
    }

    const iterMs = Date.now() - iterStart;
    if (LOG_STEPS && written.length) {
      const normNote = (NORMALIZE && normalizedFields.length) ? COLOR.gray(` normalized: [${normalizedFields.join(", ")}]`) : "";
      console.log(COLOR.green(`  iter ${i + 1} — wrote: ${written.join(", ")} ${COLOR.gray("(" + fmtMs(iterMs) + "; model " + fmtMs(thinkMs) + ")")}`) + normNote);
    } else if (LOG_STEPS) {
      console.log(COLOR.green(`  iter ${i + 1} — wrote: (none) ${COLOR.gray("(" + fmtMs(iterMs) + "; model " + fmtMs(thinkMs) + ")")}`));
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
