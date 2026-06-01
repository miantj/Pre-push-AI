import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { execFileSync } from "child_process";

const REVIEW_PKG = "cursor-pre-push-review";

export function getBundledReviewCliPath(extensionPath: string): string {
  return path.join(extensionPath, "node_modules", REVIEW_PKG, "dist", "cli.js");
}

export function isReviewCliPresent(extensionPath: string): boolean {
  return fs.existsSync(getBundledReviewCliPath(extensionPath));
}

/** 与 reviewer 一致：优先 CURSOR_AGENT_BIN，再 ~/.local/bin/agent，再 PATH 中的 agent */
export function resolveAgentBin(): string {
  const fromEnv = process.env.CURSOR_AGENT_BIN?.trim();
  if (fromEnv && fs.existsSync(fromEnv)) return fromEnv;

  const localAgent = path.join(os.homedir(), ".local", "bin", "agent");
  if (fs.existsSync(localAgent)) return localAgent;

  try {
    return execFileSync("bash", ["-lc", "command -v agent"], { encoding: "utf8" }).trim();
  } catch {
    return "";
  }
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
