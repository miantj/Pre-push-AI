import { ReviewScope } from "./types";

/** 机器可读结论行说明（自定义 prompt 缺失时自动拼接） */
export const VERDICT_INSTRUCTIONS = `
## Machine-readable verdict

After all human-readable text, output **exactly one** line on its own line, ASCII only, no code fences:

* If there is no in-scope critical/high issue:

AI_CODE_REVIEW_VERDICT: PASS

* If there is at least one in-scope critical/high issue:

AI_CODE_REVIEW_VERDICT: FAIL
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

This review may block commit/push, so only concrete critical/high issues should FAIL.

## Scope

Review **changed paths only**, but you may inspect directly related unchanged context when needed to understand changed symbols, call sites, API contracts, migrations, configuration, or tests.

Do not report unrelated pre-existing issues.

An issue may be reported as critical/high only if all are true:

1. It is introduced or exposed by this diff.
2. It has a concrete repro, request sequence, user action, deterministic trigger, or, for security/privacy issues, a clearly reachable exposure or attack path.
3. It affects core correctness, core workflow availability, data integrity, security, privacy, or production reliability.

No concrete repro/trigger/reachable security or privacy path → maximum severity is medium → do not FAIL.

Design ambiguity or product/business-rule uncertainty → mark as open question → do not FAIL.

Ignore style, naming, speculative risks, old unrelated bugs, low-severity UX, and issues outside changed paths.

## Severity

Critical:

* Data loss/corruption, security/privacy issue, core workflow completely unusable, irreversible bad action, or production crash.

High:

* Realistic user/request/job path causes materially wrong core data, blocks a core workflow, creates persistent incorrect state, or is likely to cause a bad production decision.

Medium/Low:

* Edge cases without clear material impact, uncertain behavior, maintainability, style, minor UX, missing tests without a concrete critical/high failure path, or issues requiring unusual conditions.
* Medium/Low must not cause FAIL.

Open question:

* Product/business-rule ambiguity where multiple behaviors are reasonable.
* Open questions must not cause FAIL.

## Method

1. Verify that the diff, diff stat, and relevant surrounding context are present. If any changed path from the stat is missing from the diff, or the diff appears truncated, state the limitation and do not guess.
2. Summarize what the changes do.
3. Infer intent only from commit message, diff, tests, comments, API contracts, or existing call sites.
4. Check edge cases on changed paths only.
5. Check whether critical changed behavior has corresponding tests or validation. Missing tests alone must not FAIL unless they expose a concrete critical/high issue.
6. Read every path in diff stat before PASS/FAIL.
7. Deduplicate issues with the same root cause.

## Output

* **No critical/high in-scope issue:** short paragraph; include **no critical bugs found**.
* **Has critical/high issues:** sort by severity. List every blocking issue as \`### Issue 1\`, \`### Issue 2\`, etc.

Per issue include (use ### subheadings for each field under each ### Issue N):

* **Bug & impact**
* **Concrete repro**
* **Intent vs code**
* **Root cause**
* **Minimal fix**
* **Validate**

Before the verdict line, include:

### Files reviewed

One line per changed path from stat:

* src/foo.ts ✓

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
