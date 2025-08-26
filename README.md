# llm-stepflow

A minimal, modular spine for **LLM‑planned, tool‑using workflows**. It ships with:
- Strong **types/contracts** for steps and graphs
- An **OpenAI‑compatible** chat completions adapter
- A strict **metaprompt renderer** (JSON‑only outputs)
- An **orchestrator** that executes steps, handles tool‑calling, and can branch
- A simple **Blackboard** (append‑only KV with versioning)
- **Example graphs** you can run immediately

---

## Requirements
- Node.js **>= 20**
- A model/API endpoint compatible with the *chat completions* schema
- An API key in your environment

---

## Install

```bash
npm i
```

### Configure environment
```bash
cp .env.example .env
# Set OPENAI_API_KEY (and optionally OPENAI_BASE_URL, MODEL)
```

---

## Run examples

### Minimal “hello” graph
```bash
npm run build
node dist/src/examples/minimal/run.js
```

### Math‑solve skeleton (uses the contracts & flow, not a real solver yet)
```bash
npm run build
node dist/src/examples/math_solve/run.js
```

### CLI entry (arbitrary graph)
```bash
node dist/src/index.js --graph=src/examples/minimal/graph.json
```

> Note: `tools/web.search` is a stub that returns an empty list (OK for PoC). Swap it for a real search adapter when you’re ready.

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
    openai.ts                   # OpenAICompatible adapter
  blackboard/
    index.ts                    # in‑memory KV with versioning
    fsStore.ts                  # persist artifacts under /runs/{run_id}/...
  tools/
    registry.ts                 # registers tools
    web/search.ts               # web.search({query,k}) — STUB
    cli/exec.ts                 # cli.exec({cmd,cwd,timeout_s})
    http/request.ts             # http.request({url,method,headers,body})
  prompt/
    renderer.ts                 # renderMetaprompt(step, blackboard)
    templates/step.md           # optional prompt template
  orchestrator/
    run.ts                      # runGraph(), runStep() with tool‑calling
    verify.ts                   # verifyInvariants()
    topo.ts                     # topo sort / dep checks
    budget.ts                   # token/call/wall‑time scaffolding
    planner.ts                  # toy planner example
    compiler.ts                 # validations / defaults
    branchFactory.ts            # intent → subgraph injection
    materialize.ts              # package fields → files
  workflows/library/
    deepen_search.graph.json    # reusable subgraph (example)
    resolve_discrepancy.graph.json
  examples/
    minimal/                    # tiny 1‑step graph
    math_solve/                 # outline‑based math flow (skeleton)
  tests/
    *.spec.ts                   # vitest smoke tests
```

---

## Extending

- **Add tools:** implement `ToolSpec` in `src/tools/*` and register in `tools/registry.ts`.
- **Real web search:** replace `web/search.ts` with an engine (Bing, Tavily, SerpAPI, custom) and return `{items:[{url,title,snippet}]}`.
- **Branch intents:** add cases in `orchestrator/branchFactory.ts` or import ready‑made subgraphs under `workflows/library/`.
- **Strict schemas:** tighten `outputs_schema` and `invariants` to make steps more deterministic.
- **Observability:** persist prompts/responses per step under `/runs/{run_id}/{step}/` using `blackboard/fsStore.ts`.

---

## Scripts

- `npm run build` — compile TypeScript to `dist/`
- `npm run start` — run the CLI entry (`dist/src/index.js`)
- `npm run demo` — run the minimal example (`dist/src/examples/minimal/run.js`)
- `npm run test` — run unit tests (vitest)

---

## Environment

- `OPENAI_API_KEY` — required for LLM calls.
- `OPENAI_BASE_URL` — optional (default `https://api.openai.com/v1`).
- `MODEL` — optional (default `gpt-4o-mini`).

---

## License

MIT


### Choose OpenAI adapter

Set `OPENAI_API_STYLE` to select the adapter:
- `chat` (default) — uses the legacy **Chat Completions** endpoint `/v1/chat/completions`
- `responses` — uses the newer **Responses** endpoint `/v1/responses`

```bash
# Chat Completions (default)
OPENAI_API_STYLE=chat

# Responses API
OPENAI_API_STYLE=responses
```

### Web search

This PoC uses **Tavily** for `web.search`. Set:

- `TAVILY_API_KEY` — required to get real results
- `TAVILY_BASE_URL` — optional (defaults to `https://api.tavily.com/search`)

If no key is provided, the tool returns an empty result set (so flows still run).

