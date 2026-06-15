import { execFileSync } from "child_process";
import * as fs from "fs";
import { devNull } from "os";
import * as path from "path";
import { ReviewScope } from "./types";
import { isSafeUntrackedPath } from "./pathSafety";

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

/** git diff --no-index 在有差异时 exit 1 属正常，需保留 stdout */
function tryExecGitNoIndex(repoRoot: string, file: string): TryExecGitResult {
  try {
    return { ok: true, text: execGit(repoRoot, ["diff", "--no-index", devNull, file]) };
  } catch (e: unknown) {
    const err = e as { status?: number; stdout?: string | Buffer };
    if (err.status === 1 && err.stdout != null) {
      const text = (typeof err.stdout === "string" ? err.stdout : err.stdout.toString()).trim();
      if (text) return { ok: true, text };
    }
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
    execFileSync("git", ["rev-parse", "--verify", `${ref}^{commit}`], {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
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
  return parsePositiveInt(process.env.AI_CODE_REVIEW_MAX_DIFF_CHARS, 120000);
}

/** 编译产物、依赖与锁文件不参与 AI 审查（审查对应源码即可） */
const REVIEW_SKIP_PATH_RE =
  /(?:^|\/)node_modules(?:\/|$)|(?:^|\/)dist(?:\/|$)|(?:^|\/)out(?:\/|$)|^\.DS_Store$|(?:^|\/)package-lock\.json$|\.vsix$/;

export function shouldSkipReviewPath(filePath: string): boolean {
  return REVIEW_SKIP_PATH_RE.test(filePath.replace(/\\/g, "/"));
}

export function filterReviewableChangedFiles(files: string[]): string[] {
  const filtered = files.filter((f) => !shouldSkipReviewPath(f));
  const skipped = files.length - filtered.length;
  if (skipped > 0) {
    console.log(
      `[ai-code-review] 已跳过 ${skipped} 个无需审查的路径（dist/out/node_modules 等）`
    );
  }
  return filtered;
}

export function getTotalDiffCharCount(
  repoRoot: string,
  scope: ReviewScope,
  mergeBase: string | undefined,
  files: string[]
): number {
  return files.reduce((sum, file) => {
    if (scope === "uncommitted") {
      return sum + getUncommittedFileDiffCharCount(repoRoot, file);
    }
    if (scope === "staged") {
      return sum + getStagedFileDiffCharCount(repoRoot, file);
    }
    return sum + getFileDiffCharCount(repoRoot, mergeBase!, file);
  }, 0);
}

export function getChangedFiles(repoRoot: string, mergeBase: string): string[] {
  const result = tryExecGit(repoRoot, ["diff", "--name-only", `${mergeBase}..HEAD`]);
  if (!result.ok) return [];
  return parseChangedFileLines(result.text);
}

export function getUncommittedChangedFiles(repoRoot: string): string[] {
  const tracked = tryExecGit(repoRoot, ["diff", "--name-only", "HEAD"]);
  const trackedFiles = tracked.ok ? parseChangedFileLines(tracked.text) : [];
  const untracked = getUntrackedFiles(repoRoot);
  return [...new Set([...trackedFiles, ...untracked])];
}

export function getUntrackedFiles(repoRoot: string): string[] {
  const result = tryExecGit(repoRoot, ["ls-files", "--others", "--exclude-standard"]);
  if (!result.ok) return [];
  return parseChangedFileLines(result.text);
}

export function getStagedChangedFiles(repoRoot: string): string[] {
  const result = tryExecGit(repoRoot, ["diff", "--cached", "--name-only"]);
  if (!result.ok) return [];
  return parseChangedFileLines(result.text);
}

function isUntrackedFile(repoRoot: string, filePath: string): boolean {
  const result = tryExecGit(repoRoot, ["ls-files", "--error-unmatch", "--", filePath]);
  return !result.ok;
}

function appendUntrackedDiffs(repoRoot: string, diffText: string, files: string[]): string {
  const parts = diffText ? [diffText] : [];
  for (const file of files) {
    if (!isUntrackedFile(repoRoot, file)) continue;
    if (!isSafeUntrackedPath(repoRoot, file)) continue;
    const u = tryExecGitNoIndex(repoRoot, file);
    if (u.ok && u.text.trim()) parts.push(u.text);
  }
  return parts.join("\n");
}

function parseChangedFileLines(text: string): string[] {
  return text
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

function formatUncommittedContextText(
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
    "### Review scope (uncommitted)",
    "Range **git diff HEAD** + untracked files = staged + unstaged + new files vs last commit.",
  ];
  if (batchNote) parts.push("", batchNote);
  parts.push(
    "",
    "### git diff --stat HEAD",
    statText || "(empty)",
    "",
    "### git diff HEAD",
    truncatedDiff
  );
  return { text: parts.join("\n"), truncated };
}

export function buildUncommittedGitContext(repoRoot: string): GitContext {
  const changedFiles = getUncommittedChangedFiles(repoRoot);
  const statResult = tryExecGit(repoRoot, ["diff", "--stat", "HEAD"]);
  const diffResult = tryExecGit(repoRoot, ["diff", "HEAD"]);
  let statText = statResult.ok ? statResult.text : "(empty)";
  let diffText = diffResult.ok ? diffResult.text : "";
  const diffLoadFailed = !diffResult.ok;
  const untracked = changedFiles.filter((f) => isUntrackedFile(repoRoot, f));
  if (untracked.length) {
    statText = [statText, ...untracked.map((f) => ` ${f} | new file`)].filter(Boolean).join("\n");
  }
  diffText = appendUntrackedDiffs(repoRoot, diffText, changedFiles);
  const maxDiff = getMaxDiffChars();
  const { text, truncated } = formatUncommittedContextText(
    statText,
    diffText,
    maxDiff,
    undefined,
    diffLoadFailed
  );
  return {
    ok: true,
    isEmpty: changedFiles.length === 0,
    truncated,
    diffLoadFailed,
    text,
  };
}

export function buildUncommittedGitContextForFiles(
  repoRoot: string,
  files: string[],
  batchIndex: number,
  batchTotal: number
): GitContext {
  const statResult = tryExecGit(repoRoot, ["diff", "--stat", "HEAD", "--", ...files]);
  const diffResult = tryExecGit(repoRoot, ["diff", "HEAD", "--", ...files]);
  let statText = statResult.ok ? statResult.text : "(empty)";
  let diffText = diffResult.ok ? diffResult.text : "";
  const diffLoadFailed = !diffResult.ok;
  const untracked = files.filter((f) => isUntrackedFile(repoRoot, f));
  if (untracked.length) {
    statText = [statText, ...untracked.map((f) => ` ${f} | new file`)].filter(Boolean).join("\n");
  }
  diffText = appendUntrackedDiffs(repoRoot, diffText, files);
  const maxDiff = getMaxDiffChars();
  const batchNote = [
    `### Batch scope (${batchIndex}/${batchTotal})`,
    `Review **only** these paths in this batch: ${files.join(", ")}`,
  ].join("\n");
  const { text, truncated } = formatUncommittedContextText(
    statText,
    diffText,
    maxDiff,
    batchNote,
    diffLoadFailed
  );
  return {
    ok: true,
    isEmpty: files.length === 0,
    truncated,
    diffLoadFailed,
    text,
  };
}

export function getUncommittedFileDiffCharCount(repoRoot: string, filePath: string): number {
  const tracked = tryExecGit(repoRoot, ["diff", "HEAD", "--", filePath]);
  if (tracked.ok && tracked.text.length > 0) return tracked.text.length;
  if (isUntrackedFile(repoRoot, filePath)) {
    const u = tryExecGitNoIndex(repoRoot, filePath);
    if (u.ok) return u.text.length;
  }
  return tracked.ok ? tracked.text.length : Number.MAX_SAFE_INTEGER;
}

export function splitUncommittedFilesIntoBatches(
  repoRoot: string,
  files: string[],
  maxCharsPerBatch: number
): string[][] {
  if (!files.length) return [];
  const batches: string[][] = [];
  let current: string[] = [];
  let currentSize = 0;
  for (const file of files) {
    const size = getUncommittedFileDiffCharCount(repoRoot, file);
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

export function buildGitContextForScope(
  repoRoot: string,
  scope: ReviewScope,
  baseline: string
): GitContext {
  if (scope === "uncommitted") {
    return buildUncommittedGitContext(repoRoot);
  }
  if (scope === "staged") {
    return buildStagedGitContext(repoRoot);
  }
  return buildGitContext(repoRoot, baseline);
}

function formatStagedContextText(
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
    "### Review scope (staged)",
    "Range **git diff --cached** = staged changes that will be committed.",
  ];
  if (batchNote) parts.push("", batchNote);
  parts.push(
    "",
    "### git diff --stat --cached",
    statText || "(empty)",
    "",
    "### git diff --cached",
    truncatedDiff
  );
  return { text: parts.join("\n"), truncated };
}

export function buildStagedGitContext(repoRoot: string): GitContext {
  const changedFiles = getStagedChangedFiles(repoRoot);
  const statResult = tryExecGit(repoRoot, ["diff", "--stat", "--cached"]);
  const diffResult = tryExecGit(repoRoot, ["diff", "--cached"]);
  const statText = statResult.ok ? statResult.text : "(empty)";
  const diffText = diffResult.ok ? diffResult.text : "";
  const diffLoadFailed = !diffResult.ok;
  const maxDiff = getMaxDiffChars();
  const { text, truncated } = formatStagedContextText(
    statText,
    diffText,
    maxDiff,
    undefined,
    diffLoadFailed
  );
  return {
    ok: true,
    isEmpty: changedFiles.length === 0,
    truncated,
    diffLoadFailed,
    text,
  };
}

export function buildStagedGitContextForFiles(
  repoRoot: string,
  files: string[],
  batchIndex: number,
  batchTotal: number
): GitContext {
  const statResult = tryExecGit(repoRoot, ["diff", "--stat", "--cached", "--", ...files]);
  const diffResult = tryExecGit(repoRoot, ["diff", "--cached", "--", ...files]);
  const statText = statResult.ok ? statResult.text : "(empty)";
  const diffText = diffResult.ok ? diffResult.text : "";
  const diffLoadFailed = !diffResult.ok;
  const maxDiff = getMaxDiffChars();
  const batchNote = [
    `### Batch scope (${batchIndex}/${batchTotal})`,
    `Review **only** these staged paths in this batch: ${files.join(", ")}`,
  ].join("\n");
  const { text, truncated } = formatStagedContextText(
    statText,
    diffText,
    maxDiff,
    batchNote,
    diffLoadFailed
  );
  return {
    ok: true,
    isEmpty: files.length === 0,
    truncated,
    diffLoadFailed,
    text,
  };
}

export function getStagedFileDiffCharCount(repoRoot: string, filePath: string): number {
  const result = tryExecGit(repoRoot, ["diff", "--cached", "--", filePath]);
  if (!result.ok) return Number.MAX_SAFE_INTEGER;
  return result.text.length;
}

export function splitStagedFilesIntoBatches(
  repoRoot: string,
  files: string[],
  maxCharsPerBatch: number
): string[][] {
  if (!files.length) return [];
  const batches: string[][] = [];
  let current: string[] = [];
  let currentSize = 0;
  for (const file of files) {
    const size = getStagedFileDiffCharCount(repoRoot, file);
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
