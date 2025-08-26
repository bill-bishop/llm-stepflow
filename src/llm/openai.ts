import type { CompletionArgs, CompletionOut } from "../types/llm.js";
import type { LLMProvider } from "./provider.js";

export class OpenAICompatible implements LLMProvider {
  constructor(private apiKey: string, private baseUrl = "https://api.openai.com/v1") {}

  async complete(args: CompletionArgs): Promise<CompletionOut> {
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${this.apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: args.model,
        messages: args.messages.map(m => ({
          role: m.role,
          content: m.content,
          name: m.name,
          tool_call_id: m.tool_call_id
        })),
        temperature: args.temperature ?? 0.2,
        max_tokens: args.max_tokens ?? 800,
        stop: args.stop,
        top_p: args.top_p,
        tools: args.tools?.map(t => ({
          type: "function",
          function: { name: t.name, description: t.description, parameters: t.parameters }
        })),
        tool_choice: args.tool_choice === "auto" ? "auto" : args.tool_choice,
        response_format: args.response_format
      })
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`LLM HTTP ${res.status}: ${text}`);
    }
    const data = await res.json();
    const choice = data.choices?.[0];
    const msg = choice?.message ?? {};
    const calls = (msg.tool_calls ?? []).map((c: any) => ({
      id: c.id,
      name: c.function?.name,
      arguments: c.function?.arguments
    }));
    return {
      content: msg.content ?? "",
      tool_calls: calls.length ? calls : undefined,
      finish_reason: choice?.finish_reason,
      usage: data.usage
    };
  }
}
