import * as fs from "fs";
import * as path from "path";
import { loadDefaultEditableReviewPrompt } from "../shared/reviewPromptLoader";

export const WORKSPACE_PROMPT_REL = ".cursor/ai-code-review-prompt.md";

export function workspacePromptPath(repoRoot: string): string {
  return path.join(repoRoot, WORKSPACE_PROMPT_REL);
}

export function readWorkspaceReviewPrompt(repoRoot: string): string {
  const filePath = workspacePromptPath(repoRoot);
  if (!fs.existsSync(filePath)) return "";
  try {
    return fs.readFileSync(filePath, "utf8").trim();
  } catch {
    return "";
  }
}

export function writeWorkspaceReviewPrompt(repoRoot: string, content: string): void {
  const filePath = workspacePromptPath(repoRoot);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${content.trim()}\n`, "utf8");
}

export function ensureWorkspaceReviewPrompt(
  extensionPath: string,
  repoRoot: string
): string {
  const existing = readWorkspaceReviewPrompt(repoRoot);
  if (existing) return existing;
  const defaultPrompt = loadDefaultEditableReviewPrompt(extensionPath);
  writeWorkspaceReviewPrompt(repoRoot, defaultPrompt);
  return defaultPrompt;
}
