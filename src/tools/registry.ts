import type { ToolRegistry } from "../types/tools.js";
import { webSearch } from "./web/search.js";
import { cliExec } from "./cli/exec.js";
import { httpRequest } from "./http/request.js";
import { workflowInjectSubgraph } from "./workflow/inject.js";

export function buildToolRegistry(): ToolRegistry {
  return {
    [webSearch.name]: webSearch,
    [cliExec.name]: cliExec,
    [httpRequest.name]: httpRequest,
    [workflowInjectSubgraph.name]: workflowInjectSubgraph
  };
}
