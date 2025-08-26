import type { CompletionArgs, CompletionOut } from "../types/llm.js";

export interface LLMProvider {
  complete(args: CompletionArgs): Promise<CompletionOut>;
}
