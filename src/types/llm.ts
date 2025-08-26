export type Role = "system" | "user" | "assistant" | "tool";

export interface Message {
  role: Role;
  content: string;
  name?: string;
  tool_call_id?: string;
}

export interface ToolDefForLLM {
  name: string;
  description?: string;
  parameters: object;
}

export interface CompletionArgs {
  model: string;
  messages: Message[];
  temperature?: number;
  max_tokens?: number;
  stop?: string[];
  top_p?: number;
  tools?: ToolDefForLLM[];
  tool_choice?: "auto" | { type: "function"; function: { name: string } };
  response_format?: { type: "json_object" } | { type: "text" };
  stream?: boolean;
  timeout_ms?: number;
}

export interface ToolCallOut {
  id: string;
  name: string;
  arguments: string;
}

export interface CompletionOut {
  content: string;
  tool_calls?: ToolCallOut[];
  finish_reason?: "stop" | "length" | "tool_calls" | "content_filter";
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}
