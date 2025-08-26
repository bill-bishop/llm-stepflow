import type { StepContract } from "../types/contracts.js";
import type { Blackboard } from "../blackboard/index.js";
import { read } from "../blackboard/index.js";

export interface Verdict {
  pass: boolean;
  intent?: string;
  reason?: string;
}

export function verifyInvariants(step: StepContract, bb: Blackboard): Verdict {
  for (const inv of (step.invariants ?? [])) {
    const res = evalPredicate(inv, step, bb);
    if (!res.ok) return { pass: false, intent: res.intent, reason: res.reason };
  }
  return { pass: true };
}

function evalPredicate(expr: string, step: StepContract, bb: Blackboard): { ok: boolean; intent?: string; reason?: string } {
  // Supported forms (simple and safe):
  // - len(field)>=N        -> check array length on step.field
  // - confidence>=X        -> numeric >=
  // - exists(field)        -> upstream presence
  // - eq(field,value)      -> strict equality for primitives
  try {
    if (expr.startsWith("len(")) {
      const key = expr.slice(4, expr.indexOf(")"));
      const arr = read<any[]>(bb, `${step.step_id}.${key}`);
      const num = Number(expr.split(">=")[1]);
      if (!Array.isArray(arr) || arr.length < num) return { ok: false, intent: "deepen_search", reason: expr };
      return { ok: true };
    }
    if (expr.startsWith("exists(")) {
      const key = expr.slice(7, expr.indexOf(")"));
      const val = read(bb, key) ?? read(bb, `${step.step_id}.${key}`);
      return { ok: val !== undefined };
    }
    if (expr.includes("confidence>=")) {
      const cutoff = Number(expr.split(">=")[1]);
      const c = read<number>(bb, `${step.step_id}.confidence`);
      return { ok: typeof c === "number" && c >= cutoff, intent: "deepen_search", reason: expr };
    }
    if (expr.startsWith("eq(")) {
      const inside = expr.slice(3, expr.indexOf(")"));
      const [k, v] = inside.split(",").map(s => s.trim());
      const val = read(bb, k) ?? read(bb, `${step.step_id}.${k}`);
      return { ok: JSON.stringify(val) === v };
    }
    // Unknown predicate: assume pass
    return { ok: true };
  } catch (e: any) {
    return { ok: false, reason: `predicate error: ${expr} -> ${e}` };
  }
}
