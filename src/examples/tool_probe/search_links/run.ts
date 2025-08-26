import 'dotenv/config';
import { compileGraph } from '../../../orchestrator/compiler.js';
import { runGraph } from '../../../orchestrator/run.js';
import { OpenAIChatCompletions } from '../../../llm/openai.js';
import { OpenAIResponses } from '../../../llm/openai_responses.js';
import { buildToolRegistry } from '../../../tools/registry.js';
import { createBlackboard, write, keys, read } from '../../../blackboard/index.js';
import type { StepGraph } from '../../../types/contracts.js';
import graph from './graph.json' with { type: 'json' };

async function main() {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const compiled = compileGraph(graph as unknown as StepGraph);

  const provider = (process.env.OPENAI_API_STYLE || 'chat').toLowerCase() === 'responses'
    ? new OpenAIResponses(process.env.OPENAI_API_KEY || 'DUMMY', process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1')
    : new OpenAIChatCompletions(process.env.OPENAI_API_KEY || 'DUMMY', process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1');

  const tools = buildToolRegistry();
  const blackboard = createBlackboard();

  const q = process.env.QUERY || 'What did NASA announce this week about Mars? Provide 3 bullets with links.';
  write(blackboard, 'user_query', q);

  await runGraph({
    provider, tools, graph: compiled, blackboard,
    model: process.env.MODEL || 'gpt-4o-mini',
    runId: process.env.RUN_ID || 'probe-search-' + timestamp
  });

  console.log('\n[Blackboard outputs]');
  for (const k of keys(blackboard)) {
    console.log(`• ${k}:`, JSON.stringify(read(blackboard, k), null, 2));
  }
}

main().catch(e => { console.error(e); process.exit(1); });
