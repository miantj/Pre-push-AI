import { spawnSync } from "child_process";
import * as os from "os";
import * as path from "path";
import { PrePushReviewConfig, resolveRuntimeConfig, shouldRunReview } from "./config";
import { buildGitContext, buildGitContextForFiles, getChangedFiles, getMaxDiffChars, parsePositiveInt, resolveEffectiveBaseline, splitFilesIntoBatches } from "./git";
import { findGitRepoRoot } from "./repo";
import { parseReviewVerdict, Verdict } from "./verdict";
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
4. **Exhaustive scan:** read **every path** in \`git diff --stat\` before writing PASS/FAIL. **Do not stop after the first bug.**

## Output

- **No critical in-scope bug:** short paragraph; include **no critical bugs found**.
- **Has issues:** sort by severity. List **every** in-scope critical/high issue (numbered \`### Issue 1\`, \`### Issue 2\`, …). Per item: **Bug & impact** → **Intent vs code** → **Root cause** → **Minimal fix** → **Validate**.
- Before the verdict line, include **### Files reviewed** — one line per changed path from stat (e.g. \`- src/foo.ts ✓\`). Every stat path must appear.

## Exhaustive scan (required)

- Finding **one** bug does **not** end the review. Collect **all** in-scope critical/high issues first, then output FAIL.
- Incomplete file coverage causes repeated push failures; scan the **full** diff scope before FAIL/PASS.
- If this prompt includes a **Batch scope** section, review **only** those paths in this batch, but still report **all** issues in that batch before the verdict line.

## Machine-readable verdict (required)

After all human-readable text, output **exactly one** line on its **own line** (ASCII only, no code fences):

- If there is **no** in-scope critical/high-severity bug to fix before merge:
  \`PRE_PUSH_REVIEW_VERDICT: PASS\`
- If there **is** at least one such bug:
  \`PRE_PUSH_REVIEW_VERDICT: FAIL\`

Do not add any text after that line. The automation will **block git push** when it sees FAIL.

`;

function augmentedPathEnv(): NodeJS.ProcessEnv {
  const localBin = path.join(os.homedir(), ".local", "bin");
  const pathKey = process.platform === "win32" ? "Path" : "PATH";
  const current = process.env[pathKey] ?? "";
  if (current.split(path.delimiter).includes(localBin)) {
    return { ...process.env };
  }
  return { ...process.env, [pathKey]: `${localBin}${path.delimiter}${current}` };
}

function resolveBin(envKey: string, commandName: string): string {
  const fromEnv = process.env[envKey];
  if (fromEnv != null && String(fromEnv).trim() !== "") {
    return String(fromEnv).trim();
  }
  if (commandName === "agent") {
    const localAgent = path.join(os.homedir(), ".local", "bin", "agent");
    try {
      const fs = require("fs") as typeof import("fs");
      if (fs.existsSync(localAgent)) return localAgent;
    } catch {
      // ignore
    }
  }
  try {
    const { execFileSync } = require("child_process");
    return execFileSync("bash", ["-lc", `command -v ${commandName}`], {
      encoding: "utf8",
      env: augmentedPathEnv(),
    }).trim();
  } catch {
    return "";
  }
}

function resolveBugReviewBackend(config: PrePushReviewConfig): "cursor" | "claude" {
  const raw = process.env.AI_REVIEW_AGENT;
  if (raw != null && String(raw).trim() !== "") {
    const v = String(raw).trim().toLowerCase();
    if (v === "claude" || v === "claude-code") return "claude";
    return "cursor";
  }
  return config.agent;
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

function buildReviewPrompt(ctxText: string, baseline: string): string {
  return [
    FIND_BUGS_INSTRUCTIONS,
    "",
    "## Repository context (local pre-push)",
    "",
    `Diff is **current branch vs ${baseline}** as described above. Read-only; do not modify files.`,
    "",
    ctxText,
  ].join("\n");
}

interface AgentRunResult {
  combined: string;
  cliFail: ReturnType<typeof describeCliSpawnFailure>;
}

function runReviewAgent(
  repoRoot: string,
  config: PrePushReviewConfig,
  prompt: string,
  backendLabel: string
): AgentRunResult | { error: ReviewResult } {
  const backend = resolveBugReviewBackend(config);
  let bin: string;
  let argv: string[];

  if (backend === "claude") {
    bin = resolveBin("CURSOR_PRE_PUSH_CLAUDE_BIN", "claude");
    if (!bin) {
      if (process.env.CURSOR_PRE_PUSH_ALLOW_MISSING_CLI === "1") {
        console.warn("[cursor-pre-push] 未找到 claude CLI，跳过审查");
        return { error: { ok: true, skipped: true, reason: "claude not found" } };
      }
      console.error("[cursor-pre-push] 未找到 claude CLI");
      return { error: { ok: false, reason: "claude not found" } };
    }
    argv = buildClaudeCodeArgv();
  } else {
    bin = resolveBin("CURSOR_AGENT_BIN", "agent");
    if (!bin) {
      if (process.env.CURSOR_PRE_PUSH_ALLOW_MISSING_CLI === "1") {
        console.warn("[cursor-pre-push] 未找到 agent CLI，跳过审查");
        return { error: { ok: true, skipped: true, reason: "agent not found" } };
      }
      console.error("[cursor-pre-push] 未找到 agent CLI");
      return { error: { ok: false, reason: "agent not found" } };
    }
    argv = buildCursorAgentArgv(repoRoot, prompt);
  }

  const timeoutMs = parsePositiveInt(process.env.CURSOR_PRE_PUSH_TIMEOUT_MS, config.timeoutMs);
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
    env: augmentedPathEnv(),
    timeout: timeoutMs,
    maxBuffer: 50 * 1024 * 1024,
  };
  if (backend === "claude") {
    spawnOpts.input = prompt;
  }

  console.log(`[cursor-pre-push] 正在运行 ${backendLabel} 只读审查…`);
  const r = spawnSync(bin, argv, spawnOpts);
  const combined = [r.stdout || "", r.stderr || ""].join("\n").trim();
  return { combined, cliFail: describeCliSpawnFailure(r, bin, timeoutMs) };
}

function aggregateBatchVerdict(verdicts: Array<Verdict>): Verdict {
  if (verdicts.some((v) => v === "FAIL")) return "FAIL";
  if (verdicts.length > 0 && verdicts.every((v) => v === "PASS")) return "PASS";
  return null;
}

function stripEmbeddedVerdictLines(text: string): string {
  return text.replace(/^PRE_PUSH_REVIEW_VERDICT:\s*(PASS|FAIL)\b\s*$/gim, "").trim();
}

function emitDiffTruncatedFailure(
  repoRoot: string,
  baseline: string,
  backendLabel: string,
  introLines: string[],
  combined: string
): ReviewResult {
  const reportPath = prePushReportPath(repoRoot);
  writeLastReport(repoRoot, combined, backendLabel, baseline);
  emitReviewFailureBlock({
    bannerTitle: "pre-push 审查：diff 过大",
    introLines,
    combined,
    summaryVerdict: null,
    transcriptHeading: "----- 上下文 -----",
    footerLines: [
      `完整记录：${reportPath}`,
      `可增大 CURSOR_PRE_PUSH_MAX_DIFF_CHARS（当前 ${getMaxDiffChars()}）或拆分提交后再 push`,
    ],
    baseline,
  });
  return { ok: false, reason: "diff truncated" };
}

function shouldUseBatchReview(
  ctx: { truncated?: boolean; diffLoadFailed?: boolean },
  changedFiles: string[]
): boolean {
  if (process.env.CURSOR_PRE_PUSH_BATCH_REVIEW === "0") return false;
  if (changedFiles.length === 0) return false;
  if (ctx.diffLoadFailed) return true;
  if (ctx.truncated) return true;
  return false;
}

function finalizeReviewOutcome(
  repoRoot: string,
  combined: string,
  backendLabel: string,
  baseline: string,
  explicitVerdict?: Verdict
): ReviewResult {
  const reportPath = prePushReportPath(repoRoot);
  writeLastReport(repoRoot, combined || "(no output)", backendLabel, baseline);

  const allowIssues = process.env.CURSOR_PRE_PUSH_ALLOW_ISSUES === "1";
  const verdictLoose = process.env.CURSOR_PRE_PUSH_VERDICT_LOOSE === "1";
  const verdict = explicitVerdict !== undefined ? explicitVerdict : parseReviewVerdict(combined);

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

function handleAgentCliFailure(
  repoRoot: string,
  combined: string,
  backendLabel: string,
  baseline: string,
  cliFail: NonNullable<ReturnType<typeof describeCliSpawnFailure>>
): ReviewResult {
  const softCli = process.env.CURSOR_PRE_PUSH_SOFT_CLI === "1";
  const reportPath = prePushReportPath(repoRoot);
  writeLastReport(repoRoot, combined || "(no output)", backendLabel, baseline);

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

function runBatchedFileReview(
  repoRoot: string,
  config: PrePushReviewConfig,
  baseline: string,
  mergeBase: string,
  changedFiles: string[],
  backendLabel: string,
  diffLoadFailed: boolean
): ReviewResult {
  const maxDiff = getMaxDiffChars();
  const batches = splitFilesIntoBatches(repoRoot, mergeBase, changedFiles, maxDiff);
  const batchTotal = batches.length;
  const batchReason = diffLoadFailed
    ? "完整 diff 读取失败（可能超过 maxBuffer）"
    : "diff 超过字符上限";
  console.log(
    `[cursor-pre-push] ${batchReason}，将分 ${batchTotal} 批审查（共 ${changedFiles.length} 个文件），全部完成后统一结论`
  );

  const sections: string[] = [];
  const verdicts: Array<ReturnType<typeof parseReviewVerdict>> = [];

  for (let i = 0; i < batches.length; i++) {
    const files = batches[i];
    const batchCtx = buildGitContextForFiles(
      repoRoot,
      baseline,
      mergeBase,
      files,
      i + 1,
      batchTotal
    );
    if (batchCtx.diffLoadFailed) {
      const reportPath = prePushReportPath(repoRoot);
      const msg = `[cursor-pre-push] 批次 ${i + 1}/${batchTotal} 无法读取 diff（${files.join(", ")}），可能单文件超过 maxBuffer`;
      console.error(msg);
      emitReviewFailureBlock({
        bannerTitle: "pre-push 审查：diff 读取失败",
        introLines: [msg, "无法在无 diff 内容的情况下审查，已终止 push。"],
        combined: batchCtx.text,
        summaryVerdict: null,
        transcriptHeading: "----- 上下文 -----",
        footerLines: [`完整记录：${reportPath}`],
        baseline,
      });
      return { ok: false, reason: "batch diff load failed" };
    }
    if (batchCtx.truncated) {
      const msg = `[cursor-pre-push] 批次 ${i + 1}/${batchTotal} 的 diff 超过 ${maxDiff} 字符（${files.join(", ")}），无法完整审查`;
      return emitDiffTruncatedFailure(
        repoRoot,
        baseline,
        backendLabel,
        [msg, "已终止 push。"],
        batchCtx.text
      );
    }
    const prompt = buildReviewPrompt(batchCtx.text, baseline);
    const run = runReviewAgent(repoRoot, config, prompt, backendLabel);
    if ("error" in run) return run.error;
    if (run.cliFail) {
      return handleAgentCliFailure(
        repoRoot,
        run.combined,
        backendLabel,
        baseline,
        run.cliFail
      );
    }

    const batchVerdict = parseReviewVerdict(run.combined);
    verdicts.push(batchVerdict);
    sections.push(
      [
        `## 审查批次 ${i + 1}/${batchTotal}`,
        "",
        `**文件：** ${files.join(", ")}`,
        `**批次结论：** ${batchVerdict ?? "（未输出有效 verdict）"}`,
        "",
        stripEmbeddedVerdictLines(run.combined || "(no output)"),
      ].join("\n")
    );
  }

  const overallVerdict = aggregateBatchVerdict(verdicts);
  const combinedParts = [
    "# pre-push 分批审查汇总",
    "",
    `共 ${batchTotal} 批、${changedFiles.length} 个变更文件；以下为各批完整输出（不含各批 verdict 行，避免与汇总结论混淆）。`,
    "",
    sections.join("\n\n---\n\n"),
  ];
  if (overallVerdict) {
    combinedParts.push("", `PRE_PUSH_REVIEW_VERDICT: ${overallVerdict}`);
  } else {
    combinedParts.push(
      "",
      "（部分批次缺少 PRE_PUSH_REVIEW_VERDICT: PASS/FAIL，无法汇总为 PASS）"
    );
  }
  const combined = combinedParts.join("\n");

  return finalizeReviewOutcome(
    repoRoot,
    combined,
    backendLabel,
    baseline,
    overallVerdict
  );
}

export interface ReviewResult {
  ok: boolean;
  skipped?: boolean;
  reason?: string;
}

export function runReview(startDir: string): ReviewResult {
  const repoRoot = findGitRepoRoot(startDir);
  const config = resolveRuntimeConfig(repoRoot);

  if (!shouldRunReview(config)) {
    console.log(
      "[cursor-pre-push] 审查未启用（.cursor/pre-push-review.json 中 enabled=false 或未配置）"
    );
    return { ok: true, skipped: true, reason: "disabled" };
  }

  const configuredBaseline = config.baseline;
  const { baseline, tried } = resolveEffectiveBaseline(repoRoot, configuredBaseline);
  if (!baseline) {
    console.error(
      `[cursor-pre-push] 未找到可用基线分支，已尝试：${tried.join("、")}。请先 git fetch origin`
    );
    return { ok: false, reason: "baseline not found" };
  }
  if (configuredBaseline.trim() !== "auto" && configuredBaseline !== baseline) {
    console.log(
      `[cursor-pre-push] 配置基线 ${configuredBaseline} 不可用，已改用 ${baseline}`
    );
  } else if (configuredBaseline.trim() === "auto" || !configuredBaseline.trim()) {
    console.log(`[cursor-pre-push] 自动选择基线分支：${baseline}`);
  }

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

  const backend = resolveBugReviewBackend(config);
  const backendLabel = backend === "claude" ? "Claude Code" : "Cursor Agent";
  const mergeBase = ctx.mergeBase!;
  const changedFiles = getChangedFiles(repoRoot, mergeBase);

  if (shouldUseBatchReview(ctx, changedFiles)) {
    return runBatchedFileReview(
      repoRoot,
      config,
      baseline,
      mergeBase,
      changedFiles,
      backendLabel,
      Boolean(ctx.diffLoadFailed)
    );
  }

  if (ctx.diffLoadFailed) {
    console.error(
      "[cursor-pre-push] 完整 diff 读取失败且 CURSOR_PRE_PUSH_BATCH_REVIEW=0，无法安全审查，已终止 push"
    );
    return { ok: false, reason: "diff load failed" };
  }

  if (ctx.truncated) {
    return emitDiffTruncatedFailure(
      repoRoot,
      baseline,
      backendLabel,
      [
        `[cursor-pre-push] diff 超过 ${getMaxDiffChars()} 字符且 CURSOR_PRE_PUSH_BATCH_REVIEW=0，无法完整审查`,
        "已终止 push。",
      ],
      ctx.text
    );
  }

  const prompt = buildReviewPrompt(ctx.text, baseline);
  const run = runReviewAgent(repoRoot, config, prompt, backendLabel);
  if ("error" in run) return run.error;
  if (run.cliFail) {
    return handleAgentCliFailure(
      repoRoot,
      run.combined,
      backendLabel,
      baseline,
      run.cliFail
    );
  }

  return finalizeReviewOutcome(repoRoot, run.combined, backendLabel, baseline);
}
