import * as fs from "fs";
import * as path from "path";
import { buildDefaultEditableReviewPrompt } from "./prompt";

export const PROMPT_REL_PATH = ".cursor/ai-code-review-prompt.md";

export function promptFilePath(repoRoot: string): string {
  return path.join(repoRoot, PROMPT_REL_PATH);
}

export function readReviewPromptFile(repoRoot: string): string {
  const filePath = promptFilePath(repoRoot);
  if (!fs.existsSync(filePath)) return "";
  try {
    return fs.readFileSync(filePath, "utf8").trim();
  } catch {
    return "";
  }
}

export function writeReviewPromptFile(repoRoot: string, content: string): void {
  const filePath = promptFilePath(repoRoot);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${content.trim()}\n`, "utf8");
}

/** 确保 prompt 文件存在；缺失或为空时写入默认内容 */
export function ensureReviewPromptFile(repoRoot: string): string {
  const existing = readReviewPromptFile(repoRoot);
  if (existing) return existing;
  const defaultPrompt = buildDefaultEditableReviewPrompt();
  writeReviewPromptFile(repoRoot, defaultPrompt);
  return defaultPrompt;
}
