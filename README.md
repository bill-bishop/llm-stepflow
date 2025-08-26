# llm-stepflow

A minimal, modular spine for **LLM-planned, tool-using workflows**. It includes contracts for steps, a blackboard for artifacts, a prompt renderer, an orchestrator loop (with tool-calling and branching), and an OpenAI‑compatible provider — ready for you to drop in `src/` files.

> This archive only contains the **root files**. Add the folders (`src/`, `tools/`, etc.) from our plan to start running demos.

---

## Quick start

1. **Install deps**
   ```bash
   npm i
   ```

2. **Set environment**
   ```bash
   cp .env.example .env
   # Edit .env and set OPENAI_API_KEY (and optionally OPENAI_BASE_URL)
   ```

3. **Add source files (next)**
   Create the directories from the proposed layout (`src/`, `src/llm/`, `src/orchestrator/`, etc.) and paste in the code we discussed. Then:
   ```bash
   npm run build
   npm run demo
   ```

---

## Design at a glance (what you’ll add under `src/`)

- **types/contracts.ts** — `StepGraph`, `StepContract`, `ExecutorType`.
- **blackboard/** — append‑only KV with versioning.
- **llm/provider.ts & llm/openai.ts** — adapter wrapping a `chat completions` style `getCompletions()`.
- **prompt/renderer.ts** — strict interpolation; JSON‑only outputs.
- **tools/** — uniform adapters: `web.search`, `cli.exec`, `http.request`.
- **orchestrator/** — `runStep`, invariant verification, branching, budgets.
- **workflows/library/** — reusable subgraphs (e.g., `deepen_search`).

### Example minimal runner (you’ll create later)
```ts
// src/examples/minimal/run.ts
import { runGraph } from "../../orchestrator/run";
import { compileGraph } from "../../orchestrator/compiler";
import { OpenAICompatible } from "../../llm/openai";
import { buildToolRegistry } from "../../tools/registry";

const provider = new OpenAICompatible(process.env.OPENAI_API_KEY!);
const graph = require("./graph.json");
const compiled = compileGraph(graph);

await runGraph({
  provider,
  tools: buildToolRegistry(),
  graph: compiled,
  model: process.env.MODEL || "gpt-4o-mini"
});
```

---

## Scripts

- `npm run build` — compile TypeScript to `dist/`
- `npm run start` — run `dist/src/index.js` (your CLI entry)
- `npm run demo` — run the minimal example once you add it
- `npm run test` — run unit tests (once you add them)

---

## Environment

- `OPENAI_API_KEY` — required.
- `OPENAI_BASE_URL` — optional (defaults to `https://api.openai.com/v1`).
- `MODEL` — optional (defaults to `gpt-4o-mini`).

---

## License

MIT
