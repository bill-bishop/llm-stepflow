// src/runner.ts
// Generic runner with:
// - Graph unwrap (plain or wrapped {stepgraph|graph|workflow})
// - File inputs via --file/--fileb/--filejson key=path
// - Interactive prompts for FIRST step's required inputs (after reading files)
// - file:// answers at prompts load file contents as text
// - --autorun: after running, if the last step’s outputs contain a StepGraph, compile & run it
//   **with its own missing-first-step-inputs prompt** as well.
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
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

function parseArgs(argv: string[]): { graphPath?: string; kv: KV; stdinTo?: string; files: FileSpec[]; autorun: boolean } {
  const out: { graphPath?: string; kv: KV; stdinTo?: string; files: FileSpec[]; autorun: boolean } = { kv: {}, files: [], autorun: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[i+1];
    const pushFile = (spec: string, mode: 'text'|'base64'|'json') => {
      const eq = spec.indexOf('=');
      if (eq > 0) out.files.push({ key: spec.slice(0, eq), path: spec.slice(eq+1), mode });
    };
    if (a.startsWith('--graph=')) out.graphPath = a.slice('--graph='.length);
    else if (a === '--graph' && next()) out.graphPath = argv[++i];
    else if (a.startsWith('--kv=')) {
      const kvp = a.slice('--kv='.length); const eq = kvp.indexOf('=');
      if (eq > 0) out.kv[kvp.slice(0, eq)] = kvp.slice(eq+1);
    } else if (a === '--kv' && next()) {
      const kvp = argv[++i]; const eq = kvp.indexOf('=');
      if (eq > 0) out.kv[kvp.slice(0, eq)] = kvp.slice(eq+1);
    } else if (a.startsWith('--stdin-to=')) out.stdinTo = a.slice('--stdin-to='.length);
    else if (a === '--stdin-to' && next()) out.stdinTo = argv[++i];
    else if (a.startsWith('--file=')) pushFile(a.slice('--file='.length), 'text');
    else if (a === '--file' && next()) pushFile(argv[++i], 'text');
    else if (a.startsWith('--fileb=')) pushFile(a.slice('--fileb='.length), 'base64');
    else if (a === '--fileb' && next()) pushFile(argv[++i], 'base64');
    else if (a.startsWith('--filejson=')) pushFile(a.slice('--filejson='.length), 'json');
    else if (a === '--filejson' && next()) pushFile(argv[++i], 'json');
    else if (a === '--autorun') out.autorun = true;
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
  if (typeof candidate === 'string') {
    try { candidate = JSON.parse(candidate); } catch {}
  }
  if (hasSteps(candidate)) return { graph: candidate };
  if (!candidate || typeof candidate !== 'object') throw new Error('Provided JSON is not an object.');
  const preferred = ['stepgraph', 'graph', 'workflow'];
  for (const key of preferred) {
    const inner = (candidate as any)[key];
    if (hasSteps(inner)) return { graph: inner, unwrappedFrom: key };
  }
  const keysList = Object.keys(candidate);
  if (keysList.length === 1) {
    const k = keysList[0]; const inner = (candidate as any)[k];
    if (hasSteps(inner)) return { graph: inner, unwrappedFrom: k };
  }
  for (const [k, v] of Object.entries(candidate)) {
    if (hasSteps(v)) return { graph: v as StepGraph, unwrappedFrom: String(k) };
  }
  throw new Error('No StepGraph found: expected {steps:{...},edges:[...]} or a wrapper that contains it.');
}

function tryFileUriToText(uri: string): string {
  // Accepts file:// URLs (file:///C:/path or file:///home/x), and fallback: file://C:\path
  let filePath = uri.slice('file://'.length);
  try {
    if (uri.startsWith('file:///')) {
      filePath = fileURLToPath(uri);
    }
  } catch {}
  try {
    const buf = fs.readFileSync(filePath);
    return buf.toString('utf8');
  } catch (e: any) {
    throw new Error(`Failed to read ${uri}: ${e?.message || e}`);
  }
}

async function promptForMissingInputs(step: StepContract, provided: KV): Promise<KV> {
  const interactive = (process.env.NO_INTERACTIVE ?? "0") === "0";
  if (!interactive) return {};
  const required = Array.isArray(step.inputs?.required) ? (step.inputs!.required as string[]) : [];
  const askKeys = required.filter(k => typeof k === 'string' && k.length > 0 && !k.includes('.') && provided[k] === undefined);
  if (askKeys.length === 0) return {};
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answers: KV = {};
  for (const k of askKeys) {
    const answer: string = await new Promise(res => rl.question(`Enter value for required input '${k}': `, res));
    if (answer.trim().startsWith('file://')) {
      answers[k] = tryFileUriToText(answer.trim());
    } else {
      answers[k] = answer;
    }
  }
  rl.close();
  return answers;
}

function sha256(buf: Buffer): string {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

type ReadValue = { value: any, meta: any };

function readFileSpec(spec: FileSpec, limitMB: number): ReadValue {
  const st = fs.statSync(spec.path);
  const sizeMB = st.size / (1024*1024);
  if (sizeMB > limitMB) throw new Error(`Input file too large: ${spec.path} (${sizeMB.toFixed(2)}MB > ${limitMB}MB). Set MAX_INPUT_FILE_MB to override.`);
  const buf = fs.readFileSync(spec.path);
  const meta = {
    filename: path.basename(spec.path),
    abspath: path.resolve(spec.path),
    size_bytes: st.size,
    sha256: sha256(buf),
    mtime_ms: st.mtimeMs,
    mode: spec.mode
  };
  if (spec.mode === 'base64') return { value: buf.toString('base64'), meta };
  if (spec.mode === 'json') {
    const text = buf.toString('utf8');
    try { return { value: JSON.parse(text), meta }; }
    catch (e: any) { throw new Error(`Failed to parse JSON file '${spec.path}': ${e?.message || e}`); }
  }
  return { value: buf.toString('utf8'), meta }; // text
}

function extractAutorunGraph(compiled: StepGraph, bbRead: (k: string)=>any): { graph: StepGraph, source: string } | null {
  const order = topoSort(compiled);
  if (order.length === 0) return null;
  const lastId = order[order.length - 1];
  const step = compiled.steps[lastId];
  const fields = Object.keys(step.outputs_schema || {});
  const candidates: Array<{key: string, value: any}> = [];
  for (const f of fields) {
    const v = bbRead(`${lastId}.${f}`);
    if (v !== undefined) candidates.push({ key: `${lastId}.${f}`, value: v });
  }
  for (const c of candidates) {
    try {
      const { graph } = unwrapGraph(c.value);
      return { graph, source: c.key };
    } catch {}
  }
  return null;
}

export async function runGraphFile(graphPath: string, initialKV: KV = {}, files: FileSpec[] = [], autorun = false) {
  const raw = fs.readFileSync(graphPath, 'utf8');
  const parsed = JSON.parse(raw);
  const { graph, unwrappedFrom } = unwrapGraph(parsed);
  if (unwrappedFrom) console.log(`[Runner] Unwrapped StepGraph from field '${unwrappedFrom}'.`);
  const compiled = compileGraph(graph);

  // Read files FIRST so their keys count as provided before prompting
  const limitMB = Number(process.env.MAX_INPUT_FILE_MB || 2);
  const fileKV: KV = {};
  const fileMeta: KV = {};
  for (const f of files) {
    const { value, meta } = readFileSpec(f, limitMB);
    fileKV[f.key] = value;
    fileMeta[`${f.key}__meta`] = meta;
  }

  // Determine first step and prompt for missing inputs
  const order = topoSort(compiled);
  if (order.length === 0) throw new Error('Graph has no steps.');
  const firstStepId = order[0];
  const firstStep = compiled.steps[firstStepId];
  const providedKV = { ...initialKV, ...fileKV };
  const prompted = await promptForMissingInputs(firstStep, providedKV);

  const provider = (process.env.OPENAI_API_STYLE || 'chat').toLowerCase() === 'responses'
    ? new OpenAIResponses(process.env.OPENAI_API_KEY || 'DUMMY', process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1')
    : new OpenAIChatCompletions(process.env.OPENAI_API_KEY || 'DUMMY', process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1');

  const tools = buildToolRegistry();
  const blackboard = createBlackboard();

  // Seed initial KV + files + prompted values
  const seedKV = { ...initialKV, ...fileKV, ...prompted, ...fileMeta };
  for (const [k,v] of Object.entries(seedKV)) {
    write(blackboard, k, v);
  }

  // Run the initial graph
  await runGraph({
    provider, tools, graph: compiled, blackboard,
    model: process.env.MODEL || 'gpt-4o-mini',
    runId: process.env.RUN_ID,
    maxToolExecPerStep: Number(process.env.MAX_TOOL_EXEC_PER_STEP || 8)
  });

  // Optionally autorun a produced StepGraph from the last step's outputs
  if (autorun) {
    const candidate = extractAutorunGraph(compiled, (k) => read(blackboard, k));
    if (candidate) {
      console.log(`[Runner] --autorun: executing produced StepGraph from '${candidate.source}'.`);
      const compiled2 = compileGraph(candidate.graph);

      // Before autorun, prompt for missing inputs of its first step, using current blackboard values as 'provided'
      const order2 = topoSort(compiled2);
      if (order2.length === 0) throw new Error('Autorun graph has no steps.');
      const first2 = compiled2.steps[order2[0]];

      const provided2: KV = {};
      const required2 = Array.isArray(first2.inputs?.required) ? (first2.inputs!.required as string[]) : [];
      for (const k of required2) {
        try {
          const v = read(blackboard as any, k);
          if (v !== undefined) provided2[k] = v;
        } catch {}
      }
      const prompted2 = await promptForMissingInputs(first2, provided2);
      for (const [k,v] of Object.entries(prompted2)) {
        write(blackboard, k, v);
      }

      await runGraph({
        provider, tools, graph: compiled2, blackboard,
        model: process.env.MODEL || 'gpt-4o-mini',
        runId: (process.env.RUN_ID ? process.env.RUN_ID + "-autorun" : undefined),
        maxToolExecPerStep: Number(process.env.MAX_TOOL_EXEC_PER_STEP || 8)
      });
    } else {
      console.log('[Runner] --autorun: no StepGraph found in last step outputs.');
    }
  }

  // Print blackboard contents
  console.log('\n[Blackboard]');
  for (const k of keys(blackboard)) {
    console.log(`• ${k}:`, JSON.stringify(read(blackboard, k), null, 2));
  }
}

if (process.argv[1] && path.basename(process.argv[1]).includes('runner')) {
  (async () => {
    const { graphPath, kv, stdinTo, files, autorun } = parseArgs(process.argv);
    if (!graphPath) {
      console.error('Usage: node dist/src/runner.js --graph path/to/graph.json [--kv key=value]... [--file key=path] [--fileb key=path] [--filejson key=path] [--stdin-to key] [--autorun] < input.txt');
      process.exit(2);
    }
    if (stdinTo && !process.stdin.isTTY) {
      kv[stdinTo] = await readStdin();
    }
    await runGraphFile(graphPath, kv, files, autorun);
  })().catch(e => { console.error(e); process.exit(1); });
}
