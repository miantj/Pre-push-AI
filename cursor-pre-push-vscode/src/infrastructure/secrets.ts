import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { execFileSync } from "child_process";
import { ensureGitignoreEntries } from "./gitignoreUpdater";
import { API_KEY_ENV_REL } from "../settings/settingsProvider";

const SECRET_KEY = "aiCodeReview.apiKey";

export { API_KEY_ENV_REL };

export async function getApiKey(context: vscode.ExtensionContext): Promise<string> {
  return (await context.secrets.get(SECRET_KEY)) ?? "";
}

export async function setApiKey(
  context: vscode.ExtensionContext,
  value: string
): Promise<void> {
  if (value.trim()) {
    await context.secrets.store(SECRET_KEY, value.trim());
  } else {
    await context.secrets.delete(SECRET_KEY);
  }
}

function apiKeyEnvPath(repoRoot: string): string {
  return path.join(repoRoot, API_KEY_ENV_REL);
}

function isGitTracked(repoRoot: string, relPath: string): boolean {
  try {
    execFileSync("git", ["ls-files", "--error-unmatch", relPath], {
      cwd: repoRoot,
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

/** Git hook 只能读 env 文件 / 环境变量，读不到 SecretStorage */
export function readDotEnvApiKey(repoRoot: string | undefined): string {
  if (!repoRoot) return "";
  const envPath = apiKeyEnvPath(repoRoot);
  if (!fs.existsSync(envPath)) return "";
  try {
    for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
      const m = line.match(/^\s*AI_CODE_REVIEW_API_KEY\s*=\s*(.+?)\s*$/);
      if (m) return m[1].replace(/^['"]|['"]$/g, "").trim();
    }
  } catch {
    // ignore
  }
  return "";
}

export function hasHookUsableApiKey(repoRoot: string | undefined): boolean {
  if (process.env.AI_CODE_REVIEW_API_KEY?.trim()) return true;
  return Boolean(readDotEnvApiKey(repoRoot));
}

export type WriteApiKeyResult = "ok" | "tracked" | "failed";

/** 禁用审查时删除 hook 用的 env 密钥文件（保留 .gitignore 忽略项） */
export function removeDotEnvApiKey(repoRoot: string | undefined): boolean {
  if (!repoRoot) return false;
  const envPath = apiKeyEnvPath(repoRoot);
  try {
    if (fs.existsSync(envPath)) {
      fs.unlinkSync(envPath);
    }
    return true;
  } catch {
    return false;
  }
}

/** Git hook 可读：写入 `.cursor/ai-code-review.env` */
export function writeDotEnvApiKey(
  repoRoot: string | undefined,
  apiKey: string
): WriteApiKeyResult {
  if (!repoRoot || !apiKey.trim()) return "failed";
  if (isGitTracked(repoRoot, API_KEY_ENV_REL)) {
    return "tracked";
  }

  const envPath = apiKeyEnvPath(repoRoot);
  const line = `AI_CODE_REVIEW_API_KEY=${apiKey.trim()}`;
  try {
    fs.mkdirSync(path.dirname(envPath), { recursive: true });
    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, "utf8");
      const keyRe = /^\s*AI_CODE_REVIEW_API_KEY\s*=.*$/m;
      const next = keyRe.test(content)
        ? content.replace(keyRe, line)
        : `${content.trimEnd()}\n${line}\n`;
      fs.writeFileSync(envPath, next, "utf8");
    } else {
      fs.writeFileSync(envPath, `${line}\n`, "utf8");
    }
    ensureGitignoreEntries(repoRoot);
    return "ok";
  } catch {
    return "failed";
  }
}
