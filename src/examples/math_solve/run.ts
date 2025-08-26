import 'dotenv/config';
import { compileGraph } from '../../orchestrator/compiler.js';
import { runGraph } from '../../orchestrator/run.js';
import { OpenAICompatible } from '../../llm/openai.js';
import { buildToolRegistry } from '../../tools/registry.js';
import { createBlackboard, write } from '../../blackboard/index.js';
import graph from './graph.json' assert { type: 'json' };

async function main() {
  const compiled = compileGraph(graph);
  const provider = new OpenAICompatible(process.env.OPENAI_API_KEY || "DUMMY", process.env.OPENAI_BASE_URL || "https://api.openai.com/v1");
  const tools = buildToolRegistry();
  const blackboard = createBlackboard();

  // Seed a toy problem_set so steps have inputs
  write(blackboard, "problem_set", [
    { id: 1, prompt: "Solve: 2x + 3 = 7" },
    { id: 2, prompt: "Integrate: ∫ x dx" }
  ]);

  await runGraph({
    provider,
    tools,
    graph: compiled,
    blackboard,
    model: process.env.MODEL || "gpt-4o-mini"
  });
}

main().catch(e => { console.error(e); process.exit(1); });
