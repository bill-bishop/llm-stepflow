// src/runner.ts
// Generic runner with:
// - Graph unwrap (plain or wrapped)
// - Interactive prompts for first-step required inputs
// - File inputs via --file/--fileb/--filejson key=path
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import readline from 'node:readline';
import { compileGraph } from './orchestrator/compiler.js';
import { topoSort } from './orchestrator/topo.js';
import { runGraph } from './orchestrator/run.js';
import { OpenAIChatCompletions } from './llm/openai.js';
import { OpenAIResponses } from './llm/openai_responses.js';
import { buildToolRegistry } from './tools/registry.js';
import { createBlackboard, write, keys, read } from './blackboard/index.js';
import type { StepGraph, StepContract } from './types/contracts.js';

type KV = Record<string, any>;
type FileSpec = { key: string; path: string; mode: 'text'|'base64'|'json' };

function parseArgs(argv: string[]): { graphPath?: string; kv: KV; stdinTo?: string; files: FileSpec[] } {
  const out: { graphPath?: string; kv: KV; stdinTo?: string; files: FileSpec[] } = { kv: {}, files: [] };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[i+1];
    const pushFile = (spec: string, mode: 'text'|'base64'|'json') => {
      const eq = spec.indexOf('=');
      if (eq > 0) {
        const k = spec.slice(0, eq);
        const p = spec.slice(eq+1);
        out.files.push({ key: k, path: p, mode });
      }
    };

    if (a.startsWith('--graph=')) out.graphPath = a.slice('--graph='.length);
    else if (a === '--graph' && next()) { out.graphPath = argv[++i]; }
    else if (a.startsWith('--kv=')) {
      const kvp = a.slice('--kv='.length);
      const eq = kvp.indexOf('=');
      if (eq > 0) out.kv[kvp.slice(0, eq)] = kvp.slice(eq+1);
    } else if (a === '--kv' && next()) {
      const kvp = argv[++i];
      const eq = kvp.indexOf('=');
      if (eq > 0) out.kv[kvp.slice(0, eq)] = kvp.slice(eq+1);
    } else if (a.startsWith('--stdin-to=')) {
      out.stdinTo = a.slice('--stdin-to='.length);
    } else if (a === '--stdin-to' && next()) {
      out.stdinTo = argv[++i];
    } else if (a.startsWith('--file=')) {
      pushFile(a.slice('--file='.length), 'text');
    } else if (a === '--file' && next()) {
      pushFile(argv[++i], 'text');
    } else if (a.startsWith('--fileb=')) {
      pushFile(a.slice('--fileb='.length), 'base64');
    } else if (a === '--fileb' && next()) {
      pushFile(argv[++i], 'base64');
    } else if (a.startsWith('--filejson=')) {
      pushFile(a.slice('--filejson='.length), 'json');
    } else if (a === '--filejson' && next()) {
      pushFile(argv[++i], 'json');
    }
  }
  return out;
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  return new Promise((resolve) => {
    process.stdin.on('data', (c) => chunks.push(Buffer.from(c)));
    process.stdin.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    process.stdin.resume();
  });
}

function hasSteps(obj: any): obj is StepGraph {
  return obj && typeof obj === 'object' && obj.steps && typeof obj.steps === 'object';
}

function unwrapGraph(candidate: any): { graph: StepGraph; unwrappedFrom?: string } {
  if (hasSteps(candidate)) return { graph: candidate };
  if (!candidate || typeof candidate !== 'object') {
    throw new Error('Provided JSON is not an object.');
  }
  const preferred = ['stepgraph', 'graph', 'workflow'];
  for (const key of preferred) {
    const inner = (candidate as any)[key];
    if (hasSteps(inner)) return { graph: inner, unwrappedFrom: key };
  }
  const keysList = Object.keys(candidate);
  if (keysList.length === 1) {
    const k = keysList[0];
    const inner = (candidate as any)[k];
    if (hasSteps(inner)) return { graph: inner, unwrappedFrom: k };
  }
  for (const [k, v] of Object.entries(candidate)) {
    if (hasSteps(v)) return { graph: v as StepGraph, unwrappedFrom: String(k) };
  }
  throw new Error('No StepGraph found: expected {steps:{...},edges:[...]} or a single-field object that contains it.');
}

async function promptForMissingInputs(step: StepContract, initialKV: KV): Promise<KV> {
  const interactive = (process.env.NO_INTERACTIVE ?? "0") === "0";
  if (!interactive) return {};
  const required = Array.isArray(step.inputs?.required) ? step.inputs!.required as string[] : [];
  const askKeys = required.filter(k => typeof k === 'string' && k.length > 0 && !k.includes('.') && initialKV[k] === undefined);
  if (askKeys.length === 0) return {};
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answers: KV = {};
  for (const k of askKeys) {
    const answer: string = await new Promise(res => rl.question(`Enter value for required input '${k}': `, res));
    answers[k] = answer;
  }
  rl.close();
  return answers;
}

function sha256(buf: Buffer): string {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function readFileSpec(spec: FileSpec, limitMB: number): { value: any; meta: any } {
  const st = fs.statSync(spec.path);
  const sizeMB = st.size / (1024*1024);
  if (sizeMB > limitMB) {
    throw new Error(`Input file too large: ${spec.path} (${sizeMB.toFixed(2)}MB > ${limitMB}MB). Set MAX_INPUT_FILE_MB to override.`);
  }
  const buf = fs.readFileSync(spec.path);
  const meta = {
    filename: path.basename(spec.path),
    abspath: path.resolve(spec.path),
    size_bytes: st.size,
    sha256: sha256(buf),
    mtime_ms: st.mtimeMs,
    mode: spec.mode
  };
  if (spec.mode === 'base64') {
    return { value: buf.toString('base64'), meta };
  } else if (spec.mode === 'json') {
    const text = buf.toString('utf8');
    try {
      return { value: JSON.parse(text), meta };
    } catch (e: any) {
      throw new Error(`Failed to parse JSON file '${spec.path}': ${e?.message || e}`);
    }
  } else {
    // text
    return { value: buf.toString('utf8'), meta };
  }
}

export async function runGraphFile(graphPath: string, initialKV: KV = {}, files: FileSpec[] = []) {
  const raw = fs.readFileSync(graphPath, 'utf8');
  const parsed = JSON.parse(raw);
  const { graph, unwrappedFrom } = unwrapGraph(parsed);
  if (unwrappedFrom) {
    console.log(`[Runner] Unwrapped StepGraph from field '${unwrappedFrom}'.`);
  }
  const compiled = compileGraph(graph);

  // Determine first step (entry in topo order) and prompt for missing required inputs
  const order = topoSort(compiled);
  if (order.length === 0) throw new Error('Graph has no steps.');
  const firstStepId = order[0];
  const firstStep = compiled.steps[firstStepId];
  const prompted = await promptForMissingInputs(firstStep, initialKV);

  const provider = (process.env.OPENAI_API_STYLE || 'chat').toLowerCase() === 'responses'
    ? new OpenAIResponses(process.env.OPENAI_API_KEY || 'DUMMY', process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1')
    : new OpenAIChatCompletions(process.env.OPENAI_API_KEY || 'DUMMY', process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1');

  const tools = buildToolRegistry();
  const blackboard = createBlackboard();

  // Seed initial KV + prompted values
  for (const [k,v] of Object.entries({ ...initialKV, ...prompted })) {
    write(blackboard, k, v);
  }

  // Read files and write value + metadata
  const limitMB = Number(process.env.MAX_INPUT_FILE_MB || 2);
  for (const f of files) {
    const { value, meta } = readFileSpec(f, limitMB);
    write(blackboard, f.key, value);
    write(blackboard, `${f.key}__meta`, meta);
  }

  await runGraph({
    provider, tools, graph: compiled, blackboard,
    model: process.env.MODEL || 'gpt-4o-mini',
    runId: process.env.RUN_ID,
    maxToolExecPerStep: Number(process.env.MAX_TOOL_EXEC_PER_STEP || 8)
  });

  // Print blackboard contents
  console.log('\n[Blackboard]');
  for (const k of keys(blackboard)) {
    console.log(`• ${k}:`, JSON.stringify(read(blackboard, k), null, 2));
  }
}

if (process.argv[1] && path.basename(process.argv[1]).includes('runner')) {
  (async () => {
    const { graphPath, kv, stdinTo, files } = parseArgs(process.argv);
    if (!graphPath) {
      console.error('Usage: node dist/src/runner.js --graph path/to/graph.json [--kv key=value]... [--file key=path] [--fileb key=path] [--filejson key=path] [--stdin-to user_problem] < input.txt');
      process.exit(2);
    }
    if (stdinTo) {
      if (!process.stdin.isTTY) {
        kv[stdinTo] = await readStdin();
      }
    }
    await runGraphFile(graphPath, kv, files);
  })().catch(e => { console.error(e); process.exit(1); });
}
