import type { ToolSpec } from "../../types/tools.js";

export const httpRequest: ToolSpec = {
  name: "http_request",
  input_schema: {
    url: "string (absolute URL)",
    method: "string (GET,POST,...)",
    headers: "object (optional)",
    body: "string or object (optional)"
  },
  output_schema: {
    status: "number",
    headers: "object",
    body: "string"
  },
  async invoke(args) {
    const url = String(args.url || "");
    const method = String(args.method || "GET").toUpperCase();
    const headers = (args.headers ?? {}) as Record<string, string>;
    const body = typeof args.body === "string" ? args.body : (args.body ? JSON.stringify(args.body) : undefined);
    if (!url) return { name: this.name, ok: false, output: {}, error: "missing url" };
    const res = await fetch(url, { method, headers, body });
    const text = await res.text();
    const hdrs: Record<string, string> = {};
    res.headers.forEach((v, k) => { hdrs[k] = v; });
    return { name: this.name, ok: res.ok, output: { status: res.status, headers: hdrs, body: text }, error: res.ok ? undefined : `HTTP ${res.status}` };
  }
};
