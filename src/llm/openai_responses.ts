import type { CompletionArgs, CompletionOut } from "../types/llm.js";
import type { LLMProvider } from "./provider.js";

/**
 * OpenAI "Responses" API adapter.
 */
export class OpenAIResponses implements LLMProvider {
  constructor(private apiKey: string, private baseUrl = "https://api.openai.com/v1") {}

  private toInput(messages: {role:string; content:string}[]) {
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
    if (args.response_format) payload.response_format = args.response_format;

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

    let assistantText = "";
    if (typeof data.output_text === "string") {
      assistantText = data.output_text;
    } else if (Array.isArray(data.output)) {
      const msg = data.output.find((x: any) => x.role === "assistant") || data.output[data.output.length - 1];
      if (msg?.content) {
        if (Array.isArray(msg.content)) {
          const seg = msg.content.find((c: any) => c.type === "output_text" || c.type === "text");
          assistantText = seg?.text || msg.content.map((c: any) => c.text || "").join("\n");
        } else if (typeof msg.content === "string") {
          assistantText = msg.content;
        }
      }
    } else if (data.message?.content) {
      assistantText = data.message.content;
    }

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
