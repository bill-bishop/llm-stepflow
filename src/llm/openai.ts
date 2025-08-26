import type { CompletionArgs, CompletionOut } from "../types/llm.js";
import type { LLMProvider } from "./provider.js";

export class OpenAIChatCompletions implements LLMProvider {
  constructor(
    private apiKey: string,
    private baseUrl: string = 'https://api.openai.com/v1'
  ) {}

  async complete(args: CompletionArgs): Promise<CompletionOut> {
    const url = `${this.baseUrl}/chat/completions`;

    // Map our internal messages → OpenAI schema, forwarding assistant.tool_calls and tool messages
    const messages = (args.messages as any[]).map((m: any) => {
      if (m.role === 'assistant' && Array.isArray(m.tool_calls)) {
        return {
          role: 'assistant',
          content: m.content ?? '',
          tool_calls: m.tool_calls.map((tc: any) => ({
            id: tc.id,
            type: 'function',
            function: {
              name: tc.function?.name ?? tc.name,
              arguments: typeof tc.function?.arguments === 'string' ? tc.function.arguments : (tc.arguments ?? '{}')
            }
          }))
        };
      }
      if (m.role === 'tool') {
        return {
          role: 'tool',
          content: m.content ?? '',
          tool_call_id: m.tool_call_id,
          name: m.name
        };
      }
      // system / user / plain assistant
      return { role: m.role, content: m.content ?? '' };
    });

    const tools = (args.tools || []).map(t => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description || undefined,
        parameters: t.parameters || { type: 'object', properties: {} }
      }
    }));

    const body: any = {
      model: args.model,
      messages,
      temperature: args.temperature ?? 0,
      max_tokens: args.max_tokens ?? 800,
      tools: tools.length ? tools : undefined,
      tool_choice: args.tool_choice ?? (tools.length ? 'auto' : undefined),
      response_format: args.response_format || undefined
    };

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'authorization': `Bearer ${this.apiKey}`
      },
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`LLM HTTP ${res.status}: ${text}`);
    }
    const data: any = await res.json();
    const msg = data.choices?.[0]?.message || {};

    // Normalize back to our internal shape
    const toolCalls = Array.isArray(msg.tool_calls)
      ? msg.tool_calls.map((tc: any) => ({
          id: tc.id,
          name: tc.function?.name,
          arguments: tc.function?.arguments
        }))
      : [];

    const out: CompletionOut = {
      content: msg.content ?? '',
      tool_calls: toolCalls
    };
    return out;
  }
}

/** Default export keeps backward compatibility (legacy) */
export const OpenAICompatible = OpenAIChatCompletions;
