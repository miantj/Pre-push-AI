import { execFileSync } from "child_process";

export interface GitContext {
  ok: boolean;
  text: string;
  mergeBase?: string;
  isEmpty?: boolean;
  /** 完整 diff 是否因 prompt 字符上限被截断 */
  truncated?: boolean;
  /** git diff 命令失败（如超过 maxBuffer），不能当作空 diff */
  diffLoadFailed?: boolean;
}

export type TryExecGitResult = { ok: true; text: string } | { ok: false };

export function tryExecGit(repoRoot: string, args: string[]): TryExecGitResult {
  try {
    return { ok: true, text: execGit(repoRoot, args) };
  } catch {
    return { ok: false };
  }
}

const GIT_DIFF_UNAVAILABLE =
  "(unavailable — git diff failed or output exceeded maxBuffer; use batched per-file diffs instead)";

export function execGit(repoRoot: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  }).trim();
}

export function safeExecGit(repoRoot: string, args: string[], fallback: string): string {
  try {
    return execGit(repoRoot, args);
  } catch {
    return fallback;
  }
}

/** 自动选择基线时的优先级（用户未指定或指定分支不存在时） */
export const BASELINE_CANDIDATES = [
  "origin/stable",
  "origin/dev",
  "origin/main",
  "origin/master",
] as const;

export function normalizeRemoteBaseline(branch: string): string {
  const trimmed = branch.trim();
  if (!trimmed || trimmed === "auto") return "";
  return trimmed.startsWith("origin/") ? trimmed : `origin/${trimmed}`;
}

export function remoteRefExists(repoRoot: string, ref: string): boolean {
  try {
    execGit(repoRoot, ["rev-parse", "--verify", `${ref}^{commit}`]);
    return true;
  } catch {
    return false;
  }
}

/**
 * 解析有效基线：优先使用配置/环境变量；不存在则按 stable → dev → main → master 回退。
 */
export function resolveEffectiveBaseline(
  repoRoot: string,
  configured?: string
): { baseline: string | null; tried: string[] } {
  const tried: string[] = [];
  const ordered: string[] = [];
  const normalized = normalizeRemoteBaseline(configured ?? "auto");

  if (normalized) {
    ordered.push(normalized);
  }
  for (const c of BASELINE_CANDIDATES) {
    if (!ordered.includes(c)) ordered.push(c);
  }

  for (const ref of ordered) {
    tried.push(ref);
    if (remoteRefExists(repoRoot, ref)) {
      return { baseline: ref, tried };
    }
  }
  return { baseline: null, tried };
}

export function getMergeBase(repoRoot: string, baseline: string = "origin/main"): string | null {
  try {
    return execGit(repoRoot, ["merge-base", "HEAD", baseline]);
  } catch {
    return null;
  }
}

export function getMaxDiffChars(): number {
  return parsePositiveInt(process.env.CURSOR_PRE_PUSH_MAX_DIFF_CHARS, 120000);
}

export function getChangedFiles(repoRoot: string, mergeBase: string): string[] {
  const result = tryExecGit(repoRoot, ["diff", "--name-only", `${mergeBase}..HEAD`]);
  if (!result.ok) return [];
  return result.text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

export function getFileDiffCharCount(
  repoRoot: string,
  mergeBase: string,
  filePath: string
): number {
  const result = tryExecGit(repoRoot, ["diff", `${mergeBase}..HEAD`, "--", filePath]);
  if (!result.ok) return Number.MAX_SAFE_INTEGER;
  return result.text.length;
}

/**
 * 按 diff 体量将变更文件拆成多批，保证每批完整 diff 不超过 maxCharsPerBatch。
 */
export function splitFilesIntoBatches(
  repoRoot: string,
  mergeBase: string,
  files: string[],
  maxCharsPerBatch: number
): string[][] {
  if (!files.length) return [];
  const batches: string[][] = [];
  let current: string[] = [];
  let currentSize = 0;

  for (const file of files) {
    const size = getFileDiffCharCount(repoRoot, mergeBase, file);
    if (current.length > 0 && currentSize + size > maxCharsPerBatch) {
      batches.push(current);
      current = [];
      currentSize = 0;
    }
    current.push(file);
    currentSize += size;
  }
  if (current.length) batches.push(current);
  return batches;
}

function formatGitContextText(
  baseline: string,
  mergeBase: string,
  logText: string,
  statText: string,
  diffText: string,
  maxDiff: number,
  batchNote?: string,
  diffLoadFailed?: boolean
): { text: string; truncated: boolean } {
  const truncated = !diffLoadFailed && diffText.length > maxDiff;
  const truncatedDiff = diffLoadFailed
    ? GIT_DIFF_UNAVAILABLE
    : truncated
      ? diffText.slice(0, maxDiff) + `\n\n[... truncated, original ${diffText.length} chars]`
      : diffText;

  const parts = [
    "### Review baseline (vs stable)",
    `Range **merge-base(HEAD, ${baseline})..HEAD** = commits and file changes on the current branch relative to **${baseline}**.`,
  ];
  if (batchNote) {
    parts.push("", batchNote);
  }
  parts.push(
    "",
    "### merge-base",
    mergeBase,
    "",
    "### git log --oneline merge-base..HEAD",
    logText || "(empty)",
    "",
    "### git diff --stat merge-base..HEAD",
    statText || "(empty)",
    "",
    "### git diff merge-base..HEAD",
    truncatedDiff
  );

  return { text: parts.join("\n"), truncated };
}

export function buildGitContext(repoRoot: string, baseline: string = "origin/main"): GitContext {
  const mergeBase = getMergeBase(repoRoot, baseline);
  if (!mergeBase) {
    return {
      ok: false,
      text: "(Could not compute merge-base; skip diff context.)",
    };
  }

  const changedFiles = getChangedFiles(repoRoot, mergeBase);
  const logResult = tryExecGit(repoRoot, ["log", "--oneline", `${mergeBase}..HEAD`]);
  const statResult = tryExecGit(repoRoot, ["diff", "--stat", `${mergeBase}..HEAD`]);
  const diffResult = tryExecGit(repoRoot, ["diff", `${mergeBase}..HEAD`]);

  const logText = logResult.ok ? logResult.text : "(empty)";
  const statText = statResult.ok ? statResult.text : "(empty)";
  const diffText = diffResult.ok ? diffResult.text : "";
  const diffLoadFailed = !diffResult.ok;
  const maxDiff = getMaxDiffChars();
  const { text, truncated } = formatGitContextText(
    baseline,
    mergeBase,
    logText,
    statText,
    diffText,
    maxDiff,
    undefined,
    diffLoadFailed
  );

  return {
    ok: true,
    mergeBase,
    isEmpty: changedFiles.length === 0,
    truncated,
    diffLoadFailed,
    text,
  };
}

/** 仅包含指定文件的 diff 上下文（用于分批 exhaustive 审查）。 */
export function buildGitContextForFiles(
  repoRoot: string,
  baseline: string,
  mergeBase: string,
  files: string[],
  batchIndex: number,
  batchTotal: number
): GitContext {
  const logResult = tryExecGit(repoRoot, ["log", "--oneline", `${mergeBase}..HEAD`]);
  const logText = logResult.ok ? logResult.text : "(empty)";
  const statResult = tryExecGit(
    repoRoot,
    ["diff", "--stat", `${mergeBase}..HEAD`, "--", ...files]
  );
  const diffResult = tryExecGit(
    repoRoot,
    ["diff", `${mergeBase}..HEAD`, "--", ...files]
  );
  const statText = statResult.ok ? statResult.text : "(empty)";
  const diffText = diffResult.ok ? diffResult.text : "";
  const diffLoadFailed = !diffResult.ok;
  const maxDiff = getMaxDiffChars();
  const batchNote = [
    `### Batch scope (${batchIndex}/${batchTotal})`,
    `Review **only** these changed paths in this batch: ${files.join(", ")}`,
    "Report **all** in-scope critical/high issues in this batch before the verdict line.",
  ].join("\n");
  const { text, truncated } = formatGitContextText(
    baseline,
    mergeBase,
    logText,
    statText,
    diffText,
    maxDiff,
    batchNote,
    diffLoadFailed
  );

  return {
    ok: true,
    mergeBase,
    isEmpty: files.length === 0,
    truncated,
    diffLoadFailed,
    text,
  };
}

export function parsePositiveInt(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}