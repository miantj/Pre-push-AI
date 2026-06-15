import * as fs from "fs";
import * as path from "path";
import {
  HOOK_RUNNER_REL,
  REVIEW_REPORT_REL,
  WORKSPACE_CONFIG_GUIDE_REL,
  WORKSPACE_DIR_REL,
} from "../shared/workspacePaths";

export { HOOK_RUNNER_REL, REVIEW_REPORT_REL };

const GITIGNORE_START = "# >>> ai-code-review (gitignore)";
const GITIGNORE_END = "# <<< ai-code-review (gitignore)";

export function getGitignoreEntries(): string[] {
  return [WORKSPACE_CONFIG_GUIDE_REL, REVIEW_REPORT_REL, `${WORKSPACE_DIR_REL}/`];
}

function buildManagedBlock(): string {
  return [
    GITIGNORE_START,
    "# AI Code Review 扩展自动生成，勿提交",
    ...getGitignoreEntries(),
    GITIGNORE_END,
  ].join("\n");
}

function upsertManagedBlock(existing: string, block: string): string {
  const blockRe = new RegExp(
    `${GITIGNORE_START.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[\\s\\S]*?${GITIGNORE_END.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\n?`,
    "m"
  );
  if (blockRe.test(existing)) {
    return existing.replace(blockRe, `${block}\n`);
  }
  const trimmed = existing.trimEnd();
  return trimmed ? `${trimmed}\n\n${block}\n` : `${block}\n`;
}

function removeManagedBlock(existing: string): string {
  const blockRe = new RegExp(
    `\\n?${GITIGNORE_START.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[\\s\\S]*?${GITIGNORE_END.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\n?`,
    "m"
  );
  return existing.replace(blockRe, "\n").replace(/\n{3,}/g, "\n\n").trimEnd() + (existing.trim() ? "\n" : "");
}

/** 确保 .gitignore 忽略 AI Code Review 自动生成的文件 */
export function ensureGitignoreEntries(repoRoot: string): boolean {
  if (!repoRoot) return false;
  const gitignorePath = path.join(repoRoot, ".gitignore");
  const block = buildManagedBlock();
  try {
    const existing = fs.existsSync(gitignorePath)
      ? fs.readFileSync(gitignorePath, "utf8")
      : "";
    const next = upsertManagedBlock(existing, block);
    if (next === existing && existing.includes(GITIGNORE_START)) return true;
    fs.writeFileSync(gitignorePath, next, "utf8");
    return true;
  } catch {
    return false;
  }
}

/** 移除 gitignore 片段（不删除已忽略的文件；禁用审查时不应调用，以免暴露密钥 env） */
export function removeGitignoreEntries(repoRoot: string): boolean {
  if (!repoRoot) return false;
  const gitignorePath = path.join(repoRoot, ".gitignore");
  if (!fs.existsSync(gitignorePath)) return true;
  try {
    const existing = fs.readFileSync(gitignorePath, "utf8");
    if (!existing.includes(GITIGNORE_START)) return true;
    fs.writeFileSync(gitignorePath, removeManagedBlock(existing), "utf8");
    return true;
  } catch {
    return false;
  }
}
