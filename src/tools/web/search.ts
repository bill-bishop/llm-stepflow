import type { ToolSpec } from "../../types/tools.js";

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
    if (!query) {
      return { name: this.name, ok: false, output: { items: [] }, error: "missing query" };
    }
    // PoC stub: we don't have a search API here.
    // Return an empty list but OK=true so flows can proceed when not relying on it.
    return {
      name: this.name,
      ok: true,
      output: { items: [] }
    };
  }
};
