import type { StepGraph, StepId } from "../types/contracts.js";

export function topoSort(graph: StepGraph): StepId[] {
  const indeg: Record<string, number> = {};
  const adj: Record<string, string[]> = {};
  for (const id of Object.keys(graph.steps)) {
    indeg[id] = 0; adj[id] = [];
  }
  for (const e of graph.edges) {
    indeg[e.to] += 1;
    adj[e.from].push(e.to);
  }
  const q: string[] = Object.keys(indeg).filter(k => indeg[k] === 0);
  const out: string[] = [];
  while (q.length) {
    const u = q.shift()!;
    out.push(u);
    for (const v of adj[u]) {
      indeg[v] -= 1;
      if (indeg[v] === 0) q.push(v);
    }
  }
  if (out.length !== Object.keys(graph.steps).length) {
    throw new Error("Graph has cycles or disconnected nodes");
  }
  return out;
}
