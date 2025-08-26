import type { CompletionArgs, CompletionOut, ToolDefForLLM } from "../types/llm.js";
import type { LLMProvider } from "./provider.js";

/**
 * OpenAI "Responses" API adapter (beta / evolving). This aims for compatibility with the
 * provider-agnostic CompletionOut shape used by the orchestrator.
 *
 * Notes:
 * - We map chat-style messages to an "input" array.
 * - We pass function tools if provided.
 * - We attempt to extract assistant text and tool_calls from the response's output.
 */
export class OpenAIResponses implements LLMProvider {
  constructor(private apiKey: string, private baseUrl = "https://api.openai.com/v1") {}

  private toInput(messages: {role:string; content:string}[]) {
    // Minimal mapping: array of role/content pairs; some providers accept {type:"text",text:...}
    return messages.map(m => ({ role: m.role, content: m.content }));
  }

  async complete(args: CompletionArgs): Promise<CompletionOut> {
    const url = `${this.baseUrl}/responses`;
    const payload: any = {
      model: args.model,
      input: this.toInput(args.messages),
      temperature: args.temperature ?? 0.2,
      max_output_tokens: args.max_tokens ?? 800
    };

    if (args.tools && args.tools.length) {
      payload.tools = args.tools.map(t => ({
        type: "function",
        function: { name: t.name, description: t.description, parameters: t.parameters }
      }));
      payload.tool_choice = args.tool_choice === "auto" ? "auto" : args.tool_choice;
    }
    if (args.response_format) {
      // Some providers accept a similar key; keep for compatibility
      payload.response_format = args.response_format;
    }

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${this.apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Responses HTTP ${res.status}: ${text}`);
    }
    const data: any = await res.json();

    // Try a few shapes for content extraction
    let assistantText = "";
    // Some SDKs expose consolidated output text:
    if (typeof data.output_text === "string") {
      assistantText = data.output_text;
    } else if (Array.isArray(data.output)) {
      // Find last assistant message
      const msg = data.output.find((x: any) => x.role === "assistant") || data.output[data.output.length - 1];
      if (msg?.content) {
        // content may be array of segments
        if (Array.isArray(msg.content)) {
          const textSeg = msg.content.find((c: any) => c.type === "output_text" || c.type === "text");
          if (textSeg?.text) assistantText = textSeg.text;
          else {
            // Fallback: concatenate text-like fields
            assistantText = msg.content.map((c: any) => c.text || "").join("\n");
          }
        } else if (typeof msg.content === "string") {
          assistantText = msg.content;
        }
      }
    } else if (data.message?.content) {
      assistantText = data.message.content;
    }

    // Extract function/tool calls if present
    let tool_calls: { id: string; name: string; arguments: string; }[] | undefined;
    try {
      const toolSegments =
        (data.output || [])
          .flatMap((x: any) => x?.content || [])
          .filter((c: any) => c?.type === "tool_call" || c?.type === "function_call");
      if (toolSegments.length) {
        tool_calls = toolSegments.map((seg: any, i: number) => ({
          id: seg.id || `toolcall_${i}`,
          name: seg.name || seg.function?.name,
          arguments: typeof seg.arguments === "string" ? seg.arguments : JSON.stringify(seg.arguments || {})
        }));
      }
    } catch {}

    return {
      content: assistantText || "",
      tool_calls,
      finish_reason: data.status === "completed" ? "stop" : undefined,
      usage: data.usage
        ? {
            prompt_tokens: data.usage?.input_tokens ?? 0,
            completion_tokens: data.usage?.output_tokens ?? 0,
            total_tokens: (data.usage?.input_tokens ?? 0) + (data.usage?.output_tokens ?? 0)
          }
        : undefined
    };
  }
}
