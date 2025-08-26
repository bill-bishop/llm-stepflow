# llm-stepflow

A minimal, modular spine for **LLM-planned, tool-using workflows**. It ships with:
- Strong **types/contracts** for steps and graphs
- An **OpenAI-compatible** adapter — both legacy *Chat Completions* and newer *Responses*
- A strict **metaprompt renderer** (JSON-only outputs)
- An **orchestrator** that executes steps, handles tool-calling, can branch, and supports **self-modifying subflows**
- A simple **Blackboard** (append-only KV with versioning)
- **Durable per-iteration artifacts** under `/runs/{run_id}/{step}/…`
- **Example graphs** you can run immediately

---

## Requirements
- Node.js **>= 20**
- A model/API endpoint compatible with *chat completions* or *responses*
- An API key in your environment

> TypeScript notes: examples use `import graph from './graph.json' with { type: 'json' }`. Ensure `tsconfig.json` has `"module": "NodeNext"` and `"moduleResolution": "NodeNext"` (or equivalent).

---

## Install

```bash
npm i
```

### Configure environment
```bash
cp .env.example .env
# Set OPENAI_API_KEY (and optionally OPENAI_BASE_URL, MODEL, OPENAI_API_STYLE)
# For web search, set TAVILY_API_KEY
```

---

## Run examples

### Minimal “hello” graph
```bash
npm run build
node dist/src/examples/minimal/run.js
```

### Math-solve skeleton (contracts/flow demo)
```bash
npm run build
node dist/src/examples/math_solve/run.js
```

### Simplest prompt-only flow (single intelligent step)
```bash
npm run build
# Chat Completions (default):
node dist/src/examples/prompt_only/run.js --prompt="Write a one-sentence pep talk."

# Responses API:
OPENAI_API_STYLE=responses node dist/src/examples/prompt_only/run.js --prompt="Summarize why modular workflows rock."
```

### Three-step dataflow (A → B; A,B → C)
```bash
npm run build
node dist/src/examples/three_step/run.js --text="multi-line input goes here"
```

### Tool-probe flows (exercise tools implicitly)
```bash
npm run build
# Web search → requires web_search; returns items with links
QUERY="What did NASA announce this week about Mars?" node dist/src/examples/tool_probe/search_links/run.js

# CLI listing (Windows-safe) → cli_exec
node dist/src/examples/tool_probe/cli_ls/run.js

# HTTP request (live UUID) → http_request
node dist/src/examples/tool_probe/http_uuid/run.js

# Dynamic subgraph injection → workflow_inject_subgraph + subgraph_apply
USER_GOAL="Find latest Node.js version from two sources; reconcile if they differ." node dist/src/examples/tool_probe/inject_subgraph/run.js
```

### CLI entry (arbitrary graph)
```bash
node dist/src/index.js --graph=src/examples/minimal/graph.json
```

> `tools/web/search.ts` uses **Tavily**. Provide `TAVILY_API_KEY` for real results; otherwise it returns an empty list so PoC flows still run.

---

## Choose OpenAI adapter

Set `OPENAI_API_STYLE` to select the adapter:
- `chat` (default) — legacy **Chat Completions** `/v1/chat/completions`
- `responses` — newer **Responses** `/v1/responses`

```bash
# Chat Completions (default)
OPENAI_API_STYLE=chat

# Responses API
OPENAI_API_STYLE=responses
```

---

## Project structure

```
src/
  index.ts                      # CLI entry: load graph → compile → run
  types/
    contracts.ts                # StepGraph, StepContract, ExecutorType
    llm.ts                      # Message, CompletionArgs/Out, ToolDefForLLM
    tools.ts                    # ToolSpec, ToolRegistry, ToolCall/Result
  llm/
    provider.ts                 # LLMProvider interface
    openai.ts                   # OpenAIChatCompletions (+ alias OpenAICompatible)
    openai_responses.ts         # OpenAIResponses adapter
  blackboard/
    index.ts                    # in-memory KV with versioning
    fsStore.ts                  # file persistence under /runs/{run_id}/...
  tools/
    registry.ts                 # registers tools
    web/search.ts               # Tavily-backed web_search({query,k})
    cli/exec.ts                 # cli_exec({cmd,cwd,timeout_s}) (Win/POSIX-safe)
    http/request.ts             # http_request({url,method,headers,body})
    workflow/inject.ts          # workflow_inject_subgraph tool
  prompt/
    renderer.ts                 # renderMetaprompt(step, blackboard)
    templates/step.md           # optional prompt template
  orchestrator/
    run.ts                      # runGraph(), runStep() with tool-calling loop
    verify.ts                   # verifyInvariants()
    topo.ts                     # topo sort / dep checks
    budget.ts                   # token/call/wall-time scaffolding
    planner.ts                  # toy planner example
    compiler.ts                 # validations / defaults
    branchFactory.ts            # intent → subgraph injection
    patch.ts                    # (optional) apply attach/replace patches
    materialize.ts              # writeJson() etc. for run artifacts
  workflows/library/
    deepen_search.graph.json
    resolve_discrepancy.graph.json
  examples/
    minimal/
    math_solve/
    prompt_only/
    three_step/
    tool_probe/
      search_links/
      cli_ls/
      http_uuid/
      inject_subgraph/
  tests/
    *.spec.ts
```

---

## Logging & observability

### Console logs
- **Step & iteration logs** (with timings):
  - `▶ step 2/5 list_cwd — Goal…`
  - `iter 1 — thinking`
  - `iter 1 — tool_call → cli_exec (842ms; model 310ms, tools 532ms)`
  - `↳ tool cli_exec({"cmd":"pwd"}) [118ms]` *(if `LOG_TOOLS=1`)*
  - `iter 2 — wrote: cwd, files_json (256ms; model 256ms)`
  - `✓ done list_cwd (1,147ms)`

Env flags:
```bash
LOG_STEPS=1   # default on — step/iter logs
LOG_TOOLS=1   # default off — also log tool calls & durations
QUIET=1       # silence all logs
```

### Durable artifacts (per step & iteration)
Written to `runs/{run_id}/{step_id}/`:
- `iter_{i}_request.json` — messages + LLM args
- `iter_{i}_response.json` — raw provider response
- `tool_{name}_{id}.json` — args, result, and timing
- `outputs.json` — parsed JSON outputs
- `workflow_patch_{handle}.json` — for dynamic subgraphs

Set a custom run id:
```bash
RUN_ID=my-run npm run build && node dist/src/examples/minimal/run.js
```

---

## Dynamic, self-modifying workflows (optional)

A step can propose a subgraph via tool **`workflow_inject_subgraph`**:
- Inputs: `reason`, `attach_point` (`mode`: before|after|replace|fanout, `anchor_step`), `subgraph`, `limits`
- Output: `{ approved, issues, handle, patch, compiled_subgraph, metrics }`

To **apply**, the step’s final JSON can include:
```json
{ "subgraph_apply": { "handle": "subgraph_..." } }
```
The orchestrator executes the compiled subgraph immediately (and logs artifacts).  
For true graph splicing mid-run, use `orchestrator/patch.ts` and re-toposort (optional).

---

## Extending

- **Add tools:** implement `ToolSpec` in `src/tools/*` and register in `tools/registry.ts`.  
  > Tool/function names must match `^[a-zA-Z0-9_-]+$` (we use underscores: `web_search`, `cli_exec`, `http_request`).
- **Swap web search:** replace Tavily with your engine; return `{ items: [{ url, title, snippet }] }`.
- **Branch intents:** add cases to `orchestrator/branchFactory.ts` or load subgraphs from `workflows/library/`.
- **Tighten schemas:** enforce `outputs_schema`/`invariants` per step to reduce ambiguity.

---

## Scripts

- `npm run build` — compile TypeScript to `dist/`
- `npm run start` — run the CLI entry (`dist/src/index.js`)
- `npm run demo` — run the minimal example (`dist/src/examples/minimal/run.js`)
- `npm run test` — run unit tests (vitest)

---

## Environment

- `OPENAI_API_KEY` — required for LLM calls
- `OPENAI_BASE_URL` — optional (default `https://api.openai.com/v1`)
- `OPENAI_API_STYLE` — `chat` or `responses`
- `MODEL` — optional (default `gpt-4o-mini`)
- `TAVILY_API_KEY` — required for real `web_search` results
- `RUN_ID` — optional run folder name
- `LOG_STEPS`, `LOG_TOOLS`, `QUIET` — logging controls

---

## License

MIT
