import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { execFileSync } from "child_process";

const REVIEW_PKG = "ai-code-review";

export function getBundledReviewCliPath(extensionPath: string): string {
  return path.join(extensionPath, "node_modules", REVIEW_PKG, "dist", "cli.js");
}

export function isReviewCliPresent(extensionPath: string): boolean {
  return fs.existsSync(getBundledReviewCliPath(extensionPath));
}

/** 与 reviewer 一致：优先 AI_CODE_REVIEW_AGENT_BIN，再 ~/.local/bin/agent，再 PATH 中的 agent */
export function resolveAgentBin(): string {
  const fromEnv = process.env.AI_CODE_REVIEW_AGENT_BIN?.trim();
  if (fromEnv && fs.existsSync(fromEnv)) return fromEnv;

  const localAgent = path.join(os.homedir(), ".local", "bin", "agent");
  if (fs.existsSync(localAgent)) return localAgent;

  try {
    return execFileSync("bash", ["-lc", "command -v agent"], {
      encoding: "utf8",
      env: augmentedPathEnv(),
    }).trim();
  } catch {
    return "";
  }
}

/** 与 reviewer 一致：优先 AI_CODE_REVIEW_CLAUDE_BIN，再 PATH 中的 claude */
export function resolveClaudeBin(): string {
  const fromEnv = process.env.AI_CODE_REVIEW_CLAUDE_BIN?.trim();
  if (fromEnv && fs.existsSync(fromEnv)) return fromEnv;

  try {
    return execFileSync("bash", ["-lc", "command -v claude"], {
      encoding: "utf8",
      env: augmentedPathEnv(),
    }).trim();
  } catch {
    return "";
  }
}

export type AgentCliType = "cursor" | "claude";

export function resolveAgentCliBin(agentType: AgentCliType): string {
  return agentType === "claude" ? resolveClaudeBin() : resolveAgentBin();
}

export function augmentedPathEnv(): NodeJS.ProcessEnv {
  const localBin = path.join(os.homedir(), ".local", "bin");
  const pathKey = process.platform === "win32" ? "Path" : "PATH";
  const current = process.env[pathKey] ?? "";
  if (current.split(path.delimiter).includes(localBin)) {
    return { ...process.env };
  }
  return { ...process.env, [pathKey]: `${localBin}${path.delimiter}${current}` };
}
