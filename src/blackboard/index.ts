export interface ArtifactVersion<T = unknown> {
  v: number;
  value: T;
  at: string; // ISO timestamp
}

export type Blackboard = Map<string, ArtifactVersion[]>;

export function createBlackboard(): Blackboard {
  return new Map();
}

export function read<T=unknown>(bb: Blackboard, key: string, latest: boolean = true): T | undefined {
  const arr = bb.get(key);
  if (!arr || arr.length === 0) return undefined;
  return (latest ? arr[arr.length - 1] : arr[0]).value as T;
}

export function write<T=unknown>(bb: Blackboard, key: string, value: T): ArtifactVersion<T> {
  const now = new Date().toISOString();
  const arr = bb.get(key) ?? [];
  const v = (arr[arr.length - 1]?.v ?? 0) + 1;
  const rec = { v, value, at: now };
  arr.push(rec);
  bb.set(key, arr);
  return rec;
}

export function exists(bb: Blackboard, key: string): boolean {
  const v = bb.get(key);
  return !!(v && v.length > 0);
}

export function keys(bb: Blackboard): string[] {
  return Array.from(bb.keys());
}
