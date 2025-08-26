import { exec as _exec } from "node:child_process";
import { promisify } from "node:util";
import type { ToolSpec } from "../../types/tools.js";

const execp = promisify(_exec);

export const cliExec: ToolSpec = {
  name: "cli_exec",
  input_schema: {
    cmd: "string (command to execute)",
    cwd: "string (optional working directory)",
    timeout_s: "number (optional timeout in seconds)"
  },
  output_schema: {
    stdout: "string",
    stderr: "string",
    exit_code: "number"
  },
  async invoke(args) {
    const cmd = String(args.cmd || "");
    const cwd = args.cwd ? String(args.cwd) : undefined;
    const timeout_s = args.timeout_s ? Number(args.timeout_s) : 60;
    if (!cmd) return { name: this.name, ok: false, output: {}, error: "missing cmd" };
    try {
      const { stdout, stderr } = await execp(cmd, { cwd, timeout: timeout_s * 1000, maxBuffer: 10 * 1024 * 1024 });
      return { name: this.name, ok: true, output: { stdout, stderr, exit_code: 0 } };
    } catch (e: any) {
      return { name: this.name, ok: false, output: { stdout: e.stdout ?? "", stderr: e.stderr ?? "", exit_code: e.code ?? 1 }, error: String(e.message || e) };
    }
  }
};
