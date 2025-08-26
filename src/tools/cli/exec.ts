// src/tools/cli/exec.ts (cross-platform + Windows mappings)
import type { ToolSpec } from "../../types/tools.js";
import { exec as cpExec } from "node:child_process";
import { promisify } from "node:util";
const exec = promisify(cpExec);

function isWin(): boolean { return process.platform === "win32"; }

function mapCommandForWindows(cmd: string): { shellCmd: string; shell: string | undefined } {
  const trimmed = cmd.trim();
  // Map common POSIX commands to PowerShell equivalents
  if (trimmed === "pwd") {
    return { shellCmd: 'powershell -NoProfile -NonInteractive -Command "$PWD.Path"', shell: undefined };
  }
  if (trimmed.startsWith("ls")) {
    return { shellCmd: 'powershell -NoProfile -NonInteractive -Command "Get-ChildItem -Name"', shell: undefined };
  }
  // Allow explicit cmd.exe usage: user can pass "cmd /c <...>"
  if (/^cmd(\.exe)?\s/i.test(trimmed)) {
    return { shellCmd: trimmed, shell: undefined };
  }
  // Fallback: run as a PowerShell command string
  const escaped = trimmed.replace(/"/g, '\"');
  return { shellCmd: `powershell -NoProfile -NonInteractive -Command "${escaped}"`, shell: undefined };
}

export const cliExec: ToolSpec = {
  name: "cli_exec",
  input_schema: {
    cmd: "string (command to run)",
    cwd: "string (optional working directory)",
    timeout_s: "number (optional, default 15)"
  },
  output_schema: {
    stdout: "string",
    stderr: "string",
    exit_code: "number|string (ENOENT etc.)"
  },
  async invoke(args) {
    const cmd = String((args?.cmd ?? "") || "").trim();
    if (!cmd) return { name: this.name, ok: false, output: {}, error: "cmd is required" };

    const cwd = args?.cwd ? String(args.cwd) : process.cwd();
    const timeoutMs = Math.max(1, Number(args?.timeout_s ?? 15)) * 1000;

    try {
      let shellCmd = cmd;
      let shell: string | undefined = undefined;

      if (isWin()) {
        const mapped = mapCommandForWindows(cmd);
        shellCmd = mapped.shellCmd;
        shell = mapped.shell;
      } else {
        // On POSIX, prefer bash if available for common utilities
        shell = "/bin/bash";
      }

      const { stdout, stderr } = await exec(shellCmd, { cwd, timeout: timeoutMs, shell });
      return { name: this.name, ok: true, output: { stdout, stderr, exit_code: 0 } };
    } catch (e: any) {
      const code = e?.code ?? e?.errno ?? "ERR";
      const stdout = e?.stdout ?? "";
      const stderr = e?.stderr ?? String(e?.message || e);
      return { name: this.name, ok: false, output: { stdout, stderr, exit_code: code } };
    }
  }
};
