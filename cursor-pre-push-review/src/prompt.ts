import { ReviewScope } from "./types";

/** 机器可读结论行说明（自定义 prompt 缺失时自动拼接） */
export const VERDICT_INSTRUCTIONS = `
## Machine-readable verdict (required)

After all human-readable text, output **exactly one** line on its **own line** (ASCII only, no code fences):

- If there is **no** in-scope critical/high-severity issue:
  \`AI_CODE_REVIEW_VERDICT: PASS\`
- If there **is** at least one such issue:
  \`AI_CODE_REVIEW_VERDICT: FAIL\`

Do not add any text after that line. Automation may **block git push/commit** when it sees FAIL.
`.trim();

function hasVerdictInstructions(text: string): boolean {
  return /AI_CODE_REVIEW_VERDICT/i.test(text);
}

/** 自定义 prompt 未包含 verdict 说明时自动追加，避免用户漏写导致无法解析 */
export function appendVerdictIfMissing(prompt: string): string {
  const trimmed = prompt.trim();
  if (!trimmed || hasVerdictInstructions(trimmed)) {
    return trimmed;
  }
  return [trimmed, "", VERDICT_INSTRUCTIONS].join("\n");
}

/** 默认审查指令（不含 git diff） */
export const DEFAULT_REVIEW_PROMPT = `
You are a read-only code reviewer. **Do not** create or edit files; report only.

## Goal

Review the code changes below and find issues that matter for ship quality.

## Confidence

Give a **concrete repro** (user steps or request sequence) for critical findings. No repro → lower severity → omit if not high/critical.

## Ignore

Style, naming, hypotheticals without a trigger, low-severity UX.

## Method

1. Summarize what the changes do (data/API/UI flow).
2. Infer intent from commits + diff.
3. Check edge cases on **changed paths** only.
4. **Exhaustive scan:** read **every path** in diff stat before PASS/FAIL.

## Output

- **No critical in-scope issue:** short paragraph; include **no critical bugs found**.
- **Has issues:** sort by severity. List every in-scope critical/high issue (\`### Issue 1\`, \`### Issue 2\`, …). Per item: **Bug & impact** → **Intent vs code** → **Root cause** → **Minimal fix** → **Validate**.
- Before the verdict line, include **### Files reviewed** — one line per changed path from stat (e.g. \`- src/foo.ts ✓\`).

${VERDICT_INSTRUCTIONS}
`.trim();

function scopeDescription(scope: ReviewScope, baseline: string): string {
  if (scope === "staged") {
    return "Diff is **staged changes** (`git diff --cached` — what will be committed).";
  }
  if (scope === "uncommitted") {
    return "Diff is **uncommitted changes** (`git diff HEAD` + untracked: staged + unstaged + new files vs last commit).";
  }
  return `Diff is **current branch vs ${baseline}** (\`merge-base(HEAD, ${baseline})..HEAD\`).`;
}

/** 写入 json / Settings 时展示的默认 prompt */
export function buildDefaultEditableReviewPrompt(): string {
  return DEFAULT_REVIEW_PROMPT;
}

/** reviewPrompt 为空时的兜底指令（含审查范围） */
export function buildDefaultReviewInstructions(
  scope: ReviewScope,
  baseline: string
): string {
  return [
    DEFAULT_REVIEW_PROMPT,
    "## Review scope",
    "",
    scopeDescription(scope, baseline),
    "Read-only; do not modify files.",
  ].join("\n");
}

export function buildReviewPrompt(
  _repoRoot: string,
  reviewPrompt: string,
  ctxText: string,
  scope: ReviewScope,
  baseline: string
): string {
  const customPrompt = reviewPrompt?.trim();
  const instructionBlock = customPrompt
    ? appendVerdictIfMissing(customPrompt)
    : buildDefaultReviewInstructions(scope, baseline);

  return [
    instructionBlock,
    "",
    "## Repository context",
    "",
    scopeDescription(scope, baseline),
    "",
    ctxText,
  ].join("\n");
}
