export interface ToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolResult {
  name: string;
  output: unknown;
  ok: boolean;
  error?: string;
}

export interface ToolSpec {
  name: string;
  input_schema: Record<string, string>;
  output_schema: Record<string, string>;
  invoke(args: Record<string, unknown>): Promise<ToolResult>;
}

export type ToolRegistry = Record<string, ToolSpec>;
