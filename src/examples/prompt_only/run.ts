import 'dotenv/config';
import { compileGraph } from '../../orchestrator/compiler.js';
import { runGraph } from '../../orchestrator/run.js';
import { OpenAIChatCompletions } from '../../llm/openai.js';
import { OpenAIResponses } from '../../llm/openai_responses.js';
import { buildToolRegistry } from '../../tools/registry.js';
import { createBlackboard, write } from '../../blackboard/index.js';
import graph from './graph.json' assert { type: 'json' };

function getArg(name: string, fallback?: string): string | undefined {
  const ix = process.argv.findIndex(a => a === name || a.startsWith(name + '='));
  if (ix === -1) return fallback;
  const val = process.argv[ix];
  if (val.includes('=')) return val.split('=')[1];
  return process.argv[ix+1] ?? fallback;
}

async function main() {
  const compiled = compileGraph(graph);

  const prompt = getArg('--prompt') || process.env.PROMPT || "Say hello in JSON.";
  const provider = (process.env.OPENAI_API_STYLE || 'chat').toLowerCase() === 'responses'
    ? new OpenAIResponses(process.env.OPENAI_API_KEY || 'DUMMY', process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1')
    : new OpenAIChatCompletions(process.env.OPENAI_API_KEY || 'DUMMY', process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1');

  const tools = buildToolRegistry();
  const blackboard = createBlackboard();
  write(blackboard, "user_prompt", prompt);

  await runGraph({
    provider,
    tools,
    graph: compiled,
    blackboard,
    model: process.env.MODEL || "gpt-4o-mini"
  });
}

main().catch(e => { console.error(e); process.exit(1); });
