import { spawnSync } from "child_process";
import { resolveRuntimeConfig, shouldRunReview } from "./config";
import { buildGitContext, parsePositiveInt } from "./git";
import { getCurrentBranch, findGitRepoRoot } from "./repo";
import { parseReviewVerdict } from "./verdict";
import {
  emitReviewFailureBlock,
  prePushReportPath,
  writeLastReport,
} from "./report";

const FIND_BUGS_INSTRUCTIONS = `
You are a read-only pre-push reviewer. **Do not** create or edit files; report only.

## Baseline (vs stable)

- Context below is computed from the configured baseline branch: **merge-base(HEAD, baseline)..HEAD**.
- Your job: **understand what this branch is trying to deliver** (from commit messages + the diff) and check whether the **changed code** correctly implements that intent.
- Do **not** invent requirements; if intent is unclear, say so and only report issues you can still prove from the diff.

## Goal

Find **bugs in the delta vs baseline** that matter for ship quality: data loss, auth/permission mistakes, crashes, wrong writes under normal use, broken contract vs visible spec in the diff, or clear user-facing breakage.

## Scope

- Primary evidence: **git log** and **git diff** blocks below (same merge-base..HEAD range).
- Each finding must tie to **this diff** (paths/lines or new call paths).
- If the diff ends with a truncation notice, do **not** claim critical issues for unseen hunks.

## Confidence

Give a **concrete repro** (user steps or request sequence). No repro → not critical → omit.

## Ignore

Style, naming, hypotheticals without a trigger, low-severity UX.

## Project quirks (not defects — never FAIL on these alone)

- Pre-push AI review can be disabled via workspace config; **do not** FAIL on this wiring alone.

## Method

1. Summarize what the branch changes vs baseline (data/API/UI flow).
2. Infer requirement from commits + diff only.
3. Check edge cases: empty lists, permissions, errors, async—**on changed paths**.

## Output

- **No critical in-scope bug:** short paragraph; include **no critical bugs found**.
- **Has issues:** sort by severity. Per item: **Bug & impact** → **Intent vs code** → **Root cause** → **Minimal fix** → **Validate**.

## Machine-readable verdict (required)

After all human-readable text, output **exactly one** line on its **own line** (ASCII only, no code fences):

- If there is **no** in-scope critical/high-severity bug to fix before merge:
  \`PRE_PUSH_REVIEW_VERDICT: PASS\`
- If there **is** at least one such bug:
  \`PRE_PUSH_REVIEW_VERDICT: FAIL\`

Do not add any text after that line. The automation will **block git push** when it sees FAIL.

`;

function resolveBin(envKey: string, commandName: string): string {
  const fromEnv = process.env[envKey];
  if (fromEnv != null && String(fromEnv).trim() !== "") {
    return String(fromEnv).trim();
  }
  try {
    const { execSync } = require("child_process");
    return execSync(`command -v ${commandName}`, { encoding: "utf8" }).trim();
  } catch {
    return "";
  }
}

function resolveBugReviewBackend(): "cursor" | "claude" {
  const raw = process.env.AI_REVIEW_AGENT;
  if (raw == null || String(raw).trim() === "") return "cursor";
  const v = String(raw).trim().toLowerCase();
  if (v === "claude" || v === "claude-code") return "claude";
  return "cursor";
}

function buildCursorAgentArgv(repoRoot: string, prompt: string): string[] {
  return [
    "-p",
    "--trust",
    "--force",
    "--mode=ask",
    "--workspace",
    repoRoot,
    "--output-format",
    "text",
    prompt,
  ];
}

function buildClaudeCodeArgv(): string[] {
  const argv = [
    "-p",
    "--output-format",
    "text",
    "--permission-mode",
    "plan",
    "--no-session-persistence",
    "--tools",
    "",
  ];
  const model = process.env.CURSOR_PRE_PUSH_CLAUDE_MODEL;
  if (model != null && String(model).trim() !== "") {
    argv.push("--model", String(model).trim());
  }
  return argv;
}

function normalizeRemoteBranch(branch: string): string {
  const trimmed = branch.trim();
  if (!trimmed) return "origin/main";
  return trimmed.startsWith("origin/") ? trimmed : `origin/${trimmed}`;
}

function getFetchBranchRef(branch: string): string {
  return normalizeRemoteBranch(branch).replace(/^origin\//, "");
}

function describeCliSpawnFailure(
  r: ReturnType<typeof spawnSync>,
  bin: string,
  timeoutMs: number
): { detail: string; ret: { ok: boolean; reason: string } } | null {
  if (r.error && (r.error as NodeJS.ErrnoException).code === "ETIMEDOUT") {
    return { detail: `审查超时（${timeoutMs}ms）`, ret: { ok: false, reason: "timeout" } };
  }
  if (r.error) {
    return {
      detail: `无法启动（${bin}）：${r.error.message}`,
      ret: { ok: false, reason: "spawn error" },
    };
  }
  if (r.status !== 0) {
    const sig = r.status == null && r.signal;
    return {
      detail: sig ? `被信号终止（${r.signal}）` : `退出码 ${r.status}`,
      ret: { ok: false, reason: sig ? `signal ${r.signal}` : `exit ${r.status}` },
    };
  }
  return null;
}

function maybeFetchBaseline(repoRoot: string, baseline: string): void {
  const fetchRef = baseline.replace(/^origin\//, "");
  try {
    const { execSync } = require("child_process");
    execSync(`git fetch origin ${fetchRef}`, { cwd: repoRoot, stdio: "inherit" });
  } catch {
    console.warn(
      `[cursor-pre-push] git fetch origin ${fetchRef} 失败，将使用本地 ${baseline} 引用`
    );
  }
}

export interface ReviewResult {
  ok: boolean;
  skipped?: boolean;
  reason?: string;
}

export interface RunReviewOptions {
  /** 仅审查，不 rebase（IDE「立即审查」） */
  reviewOnly?: boolean;
}

export function runReview(startDir: string, options: RunReviewOptions = {}): ReviewResult {
  const repoRoot = findGitRepoRoot(startDir);
  const config = resolveRuntimeConfig(repoRoot);

  if (!shouldRunReview(config)) {
    console.log(
      "[cursor-pre-push] 审查未启用（.cursor/pre-push-review.json 中 enabled=false 或未配置）"
    );
    return { ok: true, skipped: true, reason: "disabled" };
  }

  const withRebase = !options.reviewOnly && config.rebaseEnabled;
  const rebaseBranch = config.rebaseBranch;

  if (withRebase && rebaseBranch) {
    const branch = getCurrentBranch(repoRoot);
    const mainName = normalizeRemoteBranch(rebaseBranch).replace(/^origin\//, "");
    if (branch === "main" || branch === mainName) {
      console.log(`[cursor-pre-push] 当前在 ${branch} 分支，跳过 rebase`);
    } else {
      const remoteBranch = normalizeRemoteBranch(rebaseBranch);
      const fetchRef = getFetchBranchRef(rebaseBranch);
      console.log(
        `[cursor-pre-push] 执行 git fetch origin ${fetchRef} && git rebase ${remoteBranch}`
      );
      try {
        const { execSync } = require("child_process");
        execSync(`git fetch origin ${fetchRef}`, { cwd: repoRoot, stdio: "inherit" });
        execSync(`git rebase ${remoteBranch}`, { cwd: repoRoot, stdio: "inherit" });
      } catch (e) {
        console.error(`[cursor-pre-push] rebase 失败: ${e}`);
        return { ok: false, reason: "rebase failed" };
      }
    }
  }

  const baseline = config.baseline;
  maybeFetchBaseline(repoRoot, baseline);

  const ctx = buildGitContext(repoRoot, baseline);
  if (!ctx.ok) {
    console.error(
      `[cursor-pre-push] 无法计算 merge-base(HEAD, ${baseline})，请先执行 git fetch origin ${baseline.replace(/^origin\//, "")}`
    );
    return { ok: false, reason: "merge-base failed" };
  }

  if (ctx.isEmpty) {
    console.log(`[cursor-pre-push] 相对 ${baseline} 无增量，跳过审查`);
    return { ok: true, skipped: true, reason: "empty delta" };
  }

  const prompt = [
    FIND_BUGS_INSTRUCTIONS,
    "",
    "## Repository context (local pre-push)",
    "",
    `Diff is **current branch vs ${baseline}** as described above. Read-only; do not modify files.`,
    "",
    ctx.text,
  ].join("\n");

  const backend = resolveBugReviewBackend();
  let bin: string;
  let argv: string[];
  let backendLabel: string;

  if (backend === "claude") {
    bin = resolveBin("CURSOR_PRE_PUSH_CLAUDE_BIN", "claude");
    if (!bin) {
      if (process.env.CURSOR_PRE_PUSH_ALLOW_MISSING_CLI === "1") {
        console.warn("[cursor-pre-push] 未找到 claude CLI，跳过审查");
        return { ok: true, skipped: true, reason: "claude not found" };
      }
      console.error("[cursor-pre-push] 未找到 claude CLI");
      return { ok: false, reason: "claude not found" };
    }
    argv = buildClaudeCodeArgv();
    backendLabel = "Claude Code";
  } else {
    bin = resolveBin("CURSOR_AGENT_BIN", "agent");
    if (!bin) {
      if (process.env.CURSOR_PRE_PUSH_ALLOW_MISSING_CLI === "1") {
        console.warn("[cursor-pre-push] 未找到 agent CLI，跳过审查");
        return { ok: true, skipped: true, reason: "agent not found" };
      }
      console.error("[cursor-pre-push] 未找到 agent CLI");
      return { ok: false, reason: "agent not found" };
    }
    argv = buildCursorAgentArgv(repoRoot, prompt);
    backendLabel = "Cursor Agent";
  }

  const timeoutMs = parsePositiveInt(process.env.CURSOR_PRE_PUSH_TIMEOUT_MS, config.timeoutMs);
  const softCli = process.env.CURSOR_PRE_PUSH_SOFT_CLI === "1";
  const reportPath = prePushReportPath(repoRoot);

  console.log(`[cursor-pre-push] 正在运行 ${backendLabel} 只读审查…`);

  const spawnOpts: {
    cwd: string;
    encoding: "utf8";
    env: NodeJS.ProcessEnv;
    timeout: number;
    maxBuffer: number;
    input?: string;
  } = {
    cwd: repoRoot,
    encoding: "utf8",
    env: { ...process.env },
    timeout: timeoutMs,
    maxBuffer: 50 * 1024 * 1024,
  };
  if (backend === "claude") {
    spawnOpts.input = prompt;
  }

  const r = spawnSync(bin, argv, spawnOpts);
  const combined = [r.stdout || "", r.stderr || ""].join("\n").trim();
  writeLastReport(repoRoot, combined || "(no output)", backendLabel, baseline);

  const cliFail = describeCliSpawnFailure(r, bin, timeoutMs);
  if (cliFail) {
    if (softCli) {
      console.error(`[cursor-pre-push] ${backendLabel} ${cliFail.detail}，已跳过审查`);
      return { ok: true, skipped: true, reason: cliFail.detail };
    }
    emitReviewFailureBlock({
      bannerTitle: "pre-push 审查：进程异常",
      introLines: [
        `[cursor-pre-push] ${backendLabel} ${cliFail.detail}，已终止 push。`,
        "若确认属误报且仍需推送（不推荐）：CURSOR_PRE_PUSH_SOFT_CLI=1。",
      ],
      combined: combined || "(no output)",
      summaryVerdict: parseReviewVerdict(combined || ""),
      transcriptHeading: "----- 完整输出（stdout/stderr）-----",
      footerLines: [
        `完整记录：${reportPath}`,
        "CLI 失败仍放行 push：CURSOR_PRE_PUSH_SOFT_CLI=1",
      ],
      baseline,
    });
    return { ok: false, reason: cliFail.detail };
  }

  const allowIssues = process.env.CURSOR_PRE_PUSH_ALLOW_ISSUES === "1";
  const verdictLoose = process.env.CURSOR_PRE_PUSH_VERDICT_LOOSE === "1";
  const verdict = parseReviewVerdict(combined);

  if (!allowIssues) {
    if (verdict === "FAIL") {
      emitReviewFailureBlock({
        bannerTitle: "pre-push 审查：未通过",
        introLines: ["[cursor-pre-push] 结论：FAIL。请先阅读「一眼摘要」，再查看完整输出。"],
        combined,
        summaryVerdict: verdict,
        transcriptHeading: "----- 完整审查输出（原文）-----",
        footerLines: [
          `完整记录：${reportPath}`,
          "临时放行：CURSOR_PRE_PUSH_ALLOW_ISSUES=1 git push（不推荐）",
        ],
        baseline,
      });
      return { ok: false, reason: "review FAIL" };
    }
    if (verdict !== "PASS") {
      if (verdictLoose) {
        console.warn("[cursor-pre-push] 未解析到 verdict，VERDICT_LOOSE=1 已生效");
      } else {
        emitReviewFailureBlock({
          bannerTitle: "pre-push 审查：无法判定",
          introLines: [
            "[cursor-pre-push] 输出中缺少有效的 PRE_PUSH_REVIEW_VERDICT: PASS 或 FAIL，已终止 push。",
          ],
          combined,
          summaryVerdict: null,
          transcriptHeading: "----- 完整输出（便于排查是否漏印结论行）-----",
          footerLines: [
            `完整记录：${reportPath}`,
            "宽松模式：CURSOR_PRE_PUSH_VERDICT_LOOSE=1 git push",
          ],
          baseline,
        });
        return { ok: false, reason: "verdict not parseable" };
      }
    }
  }

  if (combined && combined.trim()) {
    console.log(combined);
  }

  return { ok: true };
}
