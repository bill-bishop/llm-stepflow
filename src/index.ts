import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { compileGraph } from './orchestrator/compiler.js';
import { runGraph } from './orchestrator/run.js';
import { OpenAICompatible, OpenAIChatCompletions } from './llm/openai.js';
import { OpenAIResponses } from './llm/openai_responses.js';
import { buildToolRegistry } from './tools/registry.js';
import { createBlackboard } from './blackboard/index.js';
import type { StepGraph } from './types/contracts.js';

function arg(name: string, fallback?: string): string | undefined {
  const ix = process.argv.findIndex(a => a === name || a.startsWith(name + '='));
  if (ix === -1) return fallback;
  const val = process.argv[ix];
  if (val.includes('=')) return val.split('=')[1];
  return process.argv[ix+1] ?? fallback;
}

async function main() {
  const graphPath = resolve(process.cwd(), arg("--graph", "src/examples/minimal/graph.json")!);
  const model = process.env.MODEL || "gpt-4o-mini";
  const apiKey = process.env.OPENAI_API_KEY;
  const style = (process.env.OPENAI_API_STYLE || "chat").toLowerCase(); // "chat" | "responses"
  if (!apiKey) {
    console.warn("[warn] OPENAI_API_KEY not set. Steps using the LLM will fail.");
  }

  const raw = readFileSync(graphPath, "utf-8");
  const graph: StepGraph = JSON.parse(raw);

  const compiled = compileGraph(graph);
  const baseUrl = process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";

  const provider =
    style === "responses"
      ? new OpenAIResponses(apiKey || "DUMMY", baseUrl)
      : new OpenAIChatCompletions(apiKey || "DUMMY", baseUrl);

  const tools = buildToolRegistry();
  const blackboard = createBlackboard();

  await runGraph({
    provider,
    tools,
    graph: compiled,
    blackboard,
    model
  });

  console.log("\n[done] run complete");
}

main().catch(err => {
  console.error("[fatal]", err);
  process.exit(1);
});
