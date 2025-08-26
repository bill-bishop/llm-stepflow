import type { StepGraph } from "../types/contracts.js";

type AttachMode = "before" | "after" | "replace" | "fanout";

export interface AttachPatch {
  op: "attach";
  mode: AttachMode;
  anchor_step: string;
  steps: StepGraph["steps"];
  edges: StepGraph["edges"];
}

/** Derive entry nodes (no incoming edges within subgraph) */
function entryNodes(steps: StepGraph["steps"], edges: StepGraph["edges"]): string[] {
  const indeg: Record<string, number> = Object.fromEntries(Object.keys(steps).map(k => [k, 0]));
  for (const e of edges) {
    if (steps[e.to]) indeg[e.to] = (indeg[e.to] ?? 0) + 1;
  }
  return Object.entries(indeg).filter(([_, d]) => d === 0).map(([k]) => k);
}

/** Derive exit nodes (no outgoing edges within subgraph) */
function exitNodes(steps: StepGraph["steps"], edges: StepGraph["edges"]): string[] {
  const outdeg: Record<string, number> = Object.fromEntries(Object.keys(steps).map(k => [k, 0]));
  for (const e of edges) {
    if (steps[e.from]) outdeg[e.from] = (outdeg[e.from] ?? 0) + 1;
  }
  return Object.entries(outdeg).filter(([_, d]) => d === 0).map(([k]) => k);
}

export function applyPatch(graph: StepGraph, patch: AttachPatch): StepGraph {
  if (patch.op !== "attach") return graph;
  const g: StepGraph = {
    steps: { ...graph.steps },
    edges: graph.edges.slice()
  };

  // Collision check
  for (const id of Object.keys(patch.steps)) {
    if (g.steps[id]) throw new Error(`applyPatch: step id collision: ${id}`);
  }

  // Add steps and internal edges
  Object.assign(g.steps, patch.steps);
  g.edges.push(...patch.edges);

  // Attach semantics (simple PoC)
  const entries = entryNodes(patch.steps, patch.edges);
  const exits = exitNodes(patch.steps, patch.edges);
  if (patch.mode === "after" || patch.mode === "fanout") {
    for (const en of entries) g.edges.push({ from: patch.anchor_step, to: en });
  } else if (patch.mode === "before") {
    for (const ex of exits) g.edges.push({ from: ex, to: patch.anchor_step });
  } else if (patch.mode === "replace") {
    const preds = g.edges.filter(e => e.to === patch.anchor_step).map(e => e.from);
    const succs = g.edges.filter(e => e.from === patch.anchor_step).map(e => e.to);
    g.edges = g.edges.filter(e => e.to !== patch.anchor_step && e.from !== patch.anchor_step);
    for (const p of preds) for (const en of entries) g.edges.push({ from: p, to: en });
    for (const ex of exits) for (const s of succs) g.edges.push({ from: ex, to: s });
    delete g.steps[patch.anchor_step];
  }

  return g;
}
