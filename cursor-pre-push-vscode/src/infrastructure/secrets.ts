import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { execFileSync } from "child_process";
import { ensureGitignoreEntries } from "./gitignoreUpdater";
import { API_KEY_ENV_REL } from "../settings/settingsProvider";

const SECRET_KEY = "aiCodeReview.apiKey";
const ALLOW_CUSTOM_URL_KEY = "AI_CODE_REVIEW_ALLOW_CUSTOM_PROVIDER_URL";

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

function shellSingleQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function parseShellQuotedEnvValue(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1).replace(/'\\''/g, "'");
  }
  return trimmed.replace(/^['"]|['"]$/g, "");
}

function isEnvFileGitIgnored(repoRoot: string): boolean {
  try {
    execFileSync("git", ["check-ignore", "-q", API_KEY_ENV_REL], {
      cwd: repoRoot,
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
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

type EnvLine =
  | { kind: "comment" | "blank"; raw: string }
  | { kind: "var"; key: string; value: string; raw: string };

function parseEnvLines(content: string): EnvLine[] {
  const lines: EnvLine[] = [];
  for (const raw of content.split("\n")) {
    if (!raw.trim()) {
      lines.push({ kind: "blank", raw });
      continue;
    }
    if (/^\s*#/.test(raw)) {
      lines.push({ kind: "comment", raw });
      continue;
    }
    const m = raw.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (m) {
      lines.push({ kind: "var", key: m[1], value: m[2], raw });
      continue;
    }
    lines.push({ kind: "comment", raw });
  }
  return lines;
}

function formatEnvVarLine(key: string, value: string): string {
  if (key === "AI_CODE_REVIEW_API_KEY") {
    return `${key}=${shellSingleQuote(value)}`;
  }
  return `${key}=${value}`;
}

function upsertEnvVar(lines: EnvLine[], key: string, value: string | null): EnvLine[] {
  const next = lines.filter((line) => !(line.kind === "var" && line.key === key));
  if (value === null) return next;
  return [
    ...next,
    {
      kind: "var",
      key,
      value,
      raw: formatEnvVarLine(key, value),
    },
  ];
}

function serializeEnvLines(lines: EnvLine[]): string {
  const body = lines.map((line) => line.raw).join("\n").trimEnd();
  return body ? `${body}\n` : "";
}

export interface HookEnvSyncOptions {
  /** 不传则保留 env 中已有的 API Key 行 */
  apiKey?: string;
  /** true 写入 ALLOW_CUSTOM；false 移除该行；undefined 不改动 */
  allowCustomProviderUrl?: boolean;
}

/** Git hook 只能读 env 文件 / 环境变量，读不到 SecretStorage */
export function readDotEnvApiKey(repoRoot: string | undefined): string {
  if (!repoRoot) return "";
  const envPath = apiKeyEnvPath(repoRoot);
  if (!fs.existsSync(envPath)) return "";
  try {
    for (const line of parseEnvLines(fs.readFileSync(envPath, "utf8"))) {
      if (line.kind === "var" && line.key === "AI_CODE_REVIEW_API_KEY") {
        return parseShellQuotedEnvValue(line.value);
      }
    }
  } catch {
    // ignore
  }
  return "";
}

/** Git hook 子进程只能读 env 文件，不继承 VS Code 宿主 process.env */
export function hasHookUsableApiKey(repoRoot: string | undefined): boolean {
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

/** Git hook 可读：同步 `.cursor/ai-code-review/env`（API Key + 私有部署开关等） */
export function syncHookEnvFile(
  repoRoot: string | undefined,
  options: HookEnvSyncOptions
): WriteApiKeyResult {
  if (!repoRoot) return "failed";
  if (isGitTracked(repoRoot, API_KEY_ENV_REL)) {
    return "tracked";
  }
  if (!ensureGitignoreEntries(repoRoot)) {
    return "failed";
  }

  const envPath = apiKeyEnvPath(repoRoot);
  const hasExisting = fs.existsSync(envPath);
  let lines: EnvLine[] = hasExisting
    ? parseEnvLines(fs.readFileSync(envPath, "utf8"))
    : [
        {
          kind: "comment",
          raw: "# AI Code Review hook 环境变量（扩展自动生成，勿提交）",
        },
      ];

  if (options.apiKey !== undefined) {
    const trimmed = options.apiKey.trim();
    lines = upsertEnvVar(lines, "AI_CODE_REVIEW_API_KEY", trimmed || null);
  }

  if (options.allowCustomProviderUrl === true) {
    lines = upsertEnvVar(lines, ALLOW_CUSTOM_URL_KEY, "1");
  } else if (options.allowCustomProviderUrl === false) {
    lines = upsertEnvVar(lines, ALLOW_CUSTOM_URL_KEY, null);
  }

  const hasManagedVar = lines.some(
    (line) =>
      line.kind === "var" &&
      (line.key === "AI_CODE_REVIEW_API_KEY" || line.key === ALLOW_CUSTOM_URL_KEY)
  );
  if (!hasManagedVar) {
    const hasUnmanagedContent = lines.some((line) => line.kind === "var");
    if (hasUnmanagedContent) {
      try {
        fs.mkdirSync(path.dirname(envPath), { recursive: true });
        fs.writeFileSync(envPath, serializeEnvLines(lines), "utf8");
        if (!isEnvFileGitIgnored(repoRoot)) {
          try {
            fs.unlinkSync(envPath);
          } catch {
            // ignore cleanup errors
          }
          return "failed";
        }
      } catch {
        return "failed";
      }
    } else if (hasExisting) {
      try {
        fs.unlinkSync(envPath);
      } catch {
        return "failed";
      }
    }
    return "ok";
  }

  try {
    fs.mkdirSync(path.dirname(envPath), { recursive: true });
    fs.writeFileSync(envPath, serializeEnvLines(lines), "utf8");
    if (!isEnvFileGitIgnored(repoRoot)) {
      try {
        fs.unlinkSync(envPath);
      } catch {
        // ignore cleanup errors
      }
      return "failed";
    }
    return "ok";
  } catch {
    return "failed";
  }
}
