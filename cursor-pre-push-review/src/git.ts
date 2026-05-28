import { execFileSync } from "child_process";

export interface GitContext {
  ok: boolean;
  text: string;
  mergeBase?: string;
  isEmpty?: boolean;
}

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

export function getMergeBase(repoRoot: string, baseline: string = "origin/stable"): string | null {
  try {
    return execGit(repoRoot, ["merge-base", "HEAD", baseline]);
  } catch {
    return null;
  }
}

export function buildGitContext(repoRoot: string, baseline: string = "origin/stable"): GitContext {
  const mergeBase = getMergeBase(repoRoot, baseline);
  if (!mergeBase) {
    return {
      ok: false,
      text: "(Could not compute merge-base; skip diff context.)",
    };
  }

  const logText = safeExecGit(repoRoot, ["log", "--oneline", `${mergeBase}..HEAD`], "(empty)");
  const statText = safeExecGit(repoRoot, ["diff", "--stat", `${mergeBase}..HEAD`], "(empty)");
  const diffText = safeExecGit(repoRoot, ["diff", `${mergeBase}..HEAD`], "(empty)");

  const maxDiff = parseInt(process.env.CURSOR_PRE_PUSH_MAX_DIFF_CHARS || "120000", 10);
  const truncatedDiff = diffText.length > maxDiff
    ? diffText.slice(0, maxDiff) + `\n\n[... truncated, original ${diffText.length} chars]`
    : diffText;

  const isEmpty =
    (!logText || logText === "(empty)") &&
    (!statText || statText === "(empty)") &&
    (!diffText || diffText === "(empty)");

  return {
    ok: true,
    mergeBase,
    isEmpty,
    text: [
      "### Review baseline (vs stable)",
      `Range **merge-base(HEAD, ${baseline})..HEAD** = commits and file changes on the current branch relative to **${baseline}**.`,
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
      truncatedDiff,
    ].join("\n"),
  };
}

export function parsePositiveInt(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}