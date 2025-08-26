import type { ToolSpec } from "../../types/tools.js";

/**
 * Tavily web search adapter.
 * Env:
 *  - TAVILY_API_KEY (required)
 *  - TAVILY_BASE_URL (optional, default: https://api.tavily.com/search)
 */
export const webSearch: ToolSpec = {
  name: "web.search",
  input_schema: {
    query: "string (search query)",
    k: "number (max results, default 5)"
  },
  output_schema: {
    items: "array<{url:string,title?:string,snippet?:string}>"
  },
  async invoke(args) {
    const query = String(args.query || "");
    const k = Number(args.k || 5);
    const apiKey = process.env.TAVILY_API_KEY;
    const baseUrl = process.env.TAVILY_BASE_URL || "https://api.tavily.com/search";
    if (!query) {
      return { name: this.name, ok: false, output: { items: [] }, error: "missing query" };
    }
    if (!apiKey) {
      // Graceful fallback for PoC runs without a key
      return {
        name: this.name,
        ok: true,
        output: { items: [] },
        error: "TAVILY_API_KEY not set; returning empty items"
      };
    }
    try {
      const res = await fetch(baseUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          api_key: apiKey,
          query,
          max_results: k
        })
      });
      const data = await res.json();
      const results = (data.results || data.data || []).map((r: any) => ({
        url: r.url || r.link || "",
        title: r.title || r.name || undefined,
        snippet: r.content || r.snippet || undefined
      })).filter((x: any) => x.url);
      return { name: this.name, ok: true, output: { items: results } };
    } catch (e: any) {
      return { name: this.name, ok: false, output: { items: [] }, error: String(e?.message || e) };
    }
  }
};
