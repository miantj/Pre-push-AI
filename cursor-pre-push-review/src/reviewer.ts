import { execFileSync, spawn, spawnSync } from "child_process";
import { logReviewStatus } from "./log";
import * as os from "os";
import * as path from "path";
import {
  isReviewSkipped,
  ResolvedRuntimeConfig,
  resolveRuntimeConfig,
  shouldRunReview,
} from "./config";
import {
  buildGitContext,
  buildGitContextForFiles,
  buildStagedGitContext,
  buildStagedGitContextForFiles,
  buildUncommittedGitContext,
  buildUncommittedGitContextForFiles,
  filterReviewableChangedFiles,
  getChangedFiles,
  getMaxDiffChars,
  getStagedChangedFiles,
  getTotalDiffCharCount,
  getUncommittedChangedFiles,
  parsePositiveInt,
  resolveEffectiveBaseline,
  splitFilesIntoBatches,
  splitStagedFilesIntoBatches,
  splitUncommittedFilesIntoBatches,
} from "./git";
import { buildReviewPrompt } from "./prompt";
import { runReviewProvider } from "./provider";
import { findGitRepoRoot } from "./repo";
import { ReviewResult, ReviewScope } from "./types";
import {
  looksLikeReviewConfigErrorAny,
  looksLikeReviewInfraFailure,
  looksLikeReviewInfraFailureAny,
  parseReviewVerdict,
  Verdict,
} from "./verdict";
import {
  emitReviewFailureBlock,
  reviewReportPath,
  writeLastReport,
} from "./report";

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
    const localAgent = path.join(
      os.homedir(),
      ".local",
      "bin",
      process.platform === "win32" ? "agent.exe" : "agent"
    );
    try {
      const fs = require("fs") as typeof import("fs");
      if (fs.existsSync(localAgent)) return localAgent;
    } catch {
      // ignore
    }
  }
  try {
    const { execFileSync } = require("child_process");
    if (process.platform === "win32") {
      const out = execFileSync("where", [commandName], {
        encoding: "utf8",
        env: augmentedPathEnv(),
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
      return out.split(/\r?\n/)[0]?.trim() || "";
    }
    return execFileSync("bash", ["-lc", `command -v ${commandName}`], {
      encoding: "utf8",
      env: augmentedPathEnv(),
    }).trim();
  } catch {
    return "";
  }
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
  const model = process.env.AI_CODE_REVIEW_CLAUDE_MODEL;
  if (model != null && String(model).trim() !== "") {
    argv.push("--model", String(model).trim());
  }
  return argv;
}

interface AgentSpawnOutcome {
  stdout: string;
  stderr: string;
  status: number | null;
  signal: NodeJS.Signals | null;
  error?: Error;
  timedOut?: boolean;
}

function describeCliSpawnFailure(
  r: ReturnType<typeof spawnSync> | AgentSpawnOutcome,
  bin: string,
  timeoutMs: number
): { detail: string; ret: { ok: boolean; reason: string } } | null {
  const timedOut =
    "timedOut" in r && r.timedOut ||
    (r.error && (r.error as NodeJS.ErrnoException).code === "ETIMEDOUT");
  if (timedOut) {
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

function spawnAgentAsync(
  bin: string,
  argv: string[],
  opts: {
    cwd: string;
    env: NodeJS.ProcessEnv;
    timeoutMs: number;
    stdinPrompt?: string;
  }
): Promise<AgentSpawnOutcome> {
  return new Promise((resolve) => {
    const proc = spawn(bin, argv, {
      cwd: opts.cwd,
      env: opts.env,
      stdio: [opts.stdinPrompt ? "pipe" : "ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;

    proc.stdout?.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    proc.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    if (opts.stdinPrompt && proc.stdin) {
      proc.stdin.write(opts.stdinPrompt);
      proc.stdin.end();
    }

    const startedAt = Date.now();
    const heartbeat = setInterval(() => {
      const mins = Math.floor((Date.now() - startedAt) / 60000);
      if (mins < 1) return;
      logReviewStatus(`仍在等待 Agent 响应，已等待 ${mins} 分钟…`);
    }, 60000);

    const timeoutHandle = setTimeout(() => {
      timedOut = true;
      proc.kill();
    }, opts.timeoutMs);

    const finish = (outcome: AgentSpawnOutcome) => {
      if (settled) return;
      settled = true;
      clearInterval(heartbeat);
      clearTimeout(timeoutHandle);
      resolve(outcome);
    };

    proc.on("close", (status, signal) => {
      finish({
        stdout,
        stderr,
        status,
        signal,
        timedOut,
      });
    });

    proc.on("error", (error) => {
      finish({
        stdout,
        stderr,
        status: null,
        signal: null,
        error,
        timedOut,
      });
    });
  });
}

function maybeFetchBaseline(repoRoot: string, baseline: string, scope: ReviewScope): void {
  if (scope === "uncommitted" || scope === "staged") return;
  if (process.env.AI_CODE_REVIEW_SKIP_FETCH === "1") return;
  const fetchRef = baseline.replace(/^origin\//, "");
  const fetchTimeoutMs = parsePositiveInt(process.env.AI_CODE_REVIEW_FETCH_TIMEOUT_MS, 60000);
  try {
    execFileSync("git", ["fetch", "origin", fetchRef], {
      cwd: repoRoot,
      stdio: "pipe",
      timeout: fetchTimeoutMs,
    });
  } catch {
    console.warn(
      `[ai-code-review] git fetch origin ${fetchRef} 失败或超时（${fetchTimeoutMs}ms），将使用本地 ${baseline} 引用`
    );
  }
}

interface BackendRunResult {
  combined: string;
  cliFail: ReturnType<typeof describeCliSpawnFailure> | null;
  skipped?: ReviewResult;
}

interface BatchProgress {
  batchIndex: number;
  batchTotal: number;
  fileCount: number;
}

async function runReviewAgent(
  repoRoot: string,
  config: ResolvedRuntimeConfig,
  prompt: string,
  backendLabel: string,
  progress?: BatchProgress
): Promise<BackendRunResult> {
  let bin: string;
  let argv: string[];
  let useStdinPrompt = false;

  if (config.agent === "claude") {
    bin = resolveBin("AI_CODE_REVIEW_CLAUDE_BIN", "claude");
    if (!bin) {
      if (process.env.AI_CODE_REVIEW_ALLOW_MISSING_CLI === "1") {
        console.warn("[ai-code-review] 未找到 claude CLI，跳过审查");
        return {
          combined: "",
          cliFail: null,
          skipped: { ok: true, skipped: true, reason: "claude not found" },
        };
      }
      console.error("[ai-code-review] 未找到 claude CLI");
      return {
        combined: "",
        cliFail: { detail: "claude not found", ret: { ok: false, reason: "claude not found" } },
      };
    }
    argv = buildClaudeCodeArgv();
    useStdinPrompt = true;
  } else {
    bin = resolveBin("AI_CODE_REVIEW_AGENT_BIN", "agent");
    if (!bin) {
      if (process.env.AI_CODE_REVIEW_ALLOW_MISSING_CLI === "1") {
        console.warn("[ai-code-review] 未找到 agent CLI，跳过审查");
        return {
          combined: "",
          cliFail: null,
          skipped: { ok: true, skipped: true, reason: "agent not found" },
        };
      }
      console.error("[ai-code-review] 未找到 agent CLI");
      return {
        combined: "",
        cliFail: { detail: "agent not found", ret: { ok: false, reason: "agent not found" } },
      };
    }
    argv = buildCursorAgentArgv(repoRoot, prompt);
    useStdinPrompt = false;
  }

  const timeoutMs = parsePositiveInt(
    process.env.AI_CODE_REVIEW_TIMEOUT_MS,
    config.timeoutMs
  );
  if (progress) {
    logReviewStatus(
      `批次 ${progress.batchIndex}/${progress.batchTotal}：正在运行 ${backendLabel} 审查（${progress.fileCount} 个文件，超时 ${Math.round(timeoutMs / 60000)} 分钟）…`
    );
  } else {
    logReviewStatus(
      `正在运行 ${backendLabel} 只读审查（超时 ${Math.round(timeoutMs / 60000)} 分钟）…`
    );
  }
  const r = await spawnAgentAsync(bin, argv, {
    cwd: repoRoot,
    env: augmentedPathEnv(),
    timeoutMs,
    stdinPrompt: useStdinPrompt ? prompt : undefined,
  });
  const combined = [r.stdout || "", r.stderr || ""].join("\n").trim();
  return { combined, cliFail: describeCliSpawnFailure(r, bin, timeoutMs) };
}

async function runReviewBackend(
  repoRoot: string,
  config: ResolvedRuntimeConfig,
  prompt: string,
  backendLabel: string,
  progress?: BatchProgress
): Promise<BackendRunResult | { error: ReviewResult }> {
  if (config.reviewMode === "provider") {
    const timeoutMs = parsePositiveInt(
      process.env.AI_CODE_REVIEW_TIMEOUT_MS,
      config.timeoutMs
    );
    logReviewStatus(`正在调用 ${backendLabel} Provider 审查…`);
    const result = await runReviewProvider(prompt, config.provider, timeoutMs);
    if (!result.ok) {
      return {
        combined: result.combined || "",
        cliFail: {
          detail: result.reason ?? "provider failed",
          ret: { ok: false, reason: result.reason ?? "provider failed" },
        },
      };
    }
    return { combined: result.combined, cliFail: null };
  }

  const run = await runReviewAgent(repoRoot, config, prompt, backendLabel, progress);
  if (run.skipped) return { error: run.skipped };
  return run;
}

function backendLabel(config: ResolvedRuntimeConfig): string {
  if (config.reviewMode === "provider") {
    return `${config.provider.type} (${config.provider.model})`;
  }
  return config.agent === "claude" ? "Claude Code" : "Cursor Agent";
}

function aggregateBatchVerdict(verdicts: Array<Verdict>): Verdict {
  if (verdicts.some((v) => v === "FAIL")) return "FAIL";
  if (verdicts.length > 0 && verdicts.every((v) => v === "PASS")) return "PASS";
  return null;
}

function stripEmbeddedVerdictLines(text: string): string {
  return text.replace(/^AI_CODE_REVIEW_VERDICT:\s*(PASS|FAIL)\b\s*$/gim, "").trim();
}

function emitDiffTruncatedFailure(
  repoRoot: string,
  baseline: string,
  backendLabel: string,
  introLines: string[],
  combined: string,
  blockOnFail: boolean
): ReviewResult {
  const reportPath = reviewReportPath(repoRoot);
  writeLastReport(repoRoot, combined, backendLabel, baseline);
  if (!blockOnFail) {
    console.warn("[ai-code-review] diff 过大，手动审查模式不阻断 git 操作");
    return { ok: false, skipped: true, reason: "diff truncated" };
  }
  emitReviewFailureBlock({
    bannerTitle: "AI Code Review：diff 过大",
    introLines,
    combined,
    summaryVerdict: null,
    transcriptHeading: "----- 上下文 -----",
    footerLines: [
      `完整记录：${reportPath}`,
      `可增大 AI_CODE_REVIEW_MAX_DIFF_CHARS（当前 ${getMaxDiffChars()}）或拆分提交`,
    ],
    baseline,
  });
  return { ok: false, reason: "diff truncated" };
}

function shouldUseBatchReview(
  ctx: { diffLoadFailed?: boolean },
  changedFiles: string[],
  totalDiffChars: number
): boolean {
  if (process.env.AI_CODE_REVIEW_BATCH_REVIEW === "0") {
    return false;
  }
  if (changedFiles.length === 0) return false;
  if (ctx.diffLoadFailed) return true;
  return totalDiffChars > getMaxDiffChars();
}

function finalizeReviewOutcome(
  repoRoot: string,
  combined: string,
  label: string,
  baseline: string,
  blockOnFail: boolean,
  explicitVerdict?: Verdict
): ReviewResult {
  const reportPath = reviewReportPath(repoRoot);
  writeLastReport(repoRoot, combined || "(no output)", label, baseline);

  const allowIssues = process.env.AI_CODE_REVIEW_ALLOW_ISSUES === "1";
  const verdictLoose = process.env.AI_CODE_REVIEW_VERDICT_LOOSE === "1";
  const verdict = explicitVerdict !== undefined ? explicitVerdict : parseReviewVerdict(combined);

  if (!allowIssues) {
    if (verdict === "FAIL") {
      if (!blockOnFail) {
        console.warn("[ai-code-review] 结论 FAIL（手动审查，不阻断 git 操作）");
        if (combined?.trim()) console.log(combined);
        return { ok: false, reason: "review FAIL (non-blocking)" };
      }
      emitReviewFailureBlock({
        bannerTitle: "AI Code Review：未通过",
        introLines: ["[ai-code-review] 结论：FAIL。请先阅读「一眼摘要」，再查看完整输出。"],
        combined,
        summaryVerdict: verdict,
        transcriptHeading: "----- 完整审查输出（原文）-----",
        footerLines: [
          `完整记录：${reportPath}`,
          "临时放行：AI_CODE_REVIEW_ALLOW_ISSUES=1",
        ],
        baseline,
      });
      return { ok: false, reason: "review FAIL" };
    }
    if (verdict !== "PASS") {
      const configError = looksLikeReviewConfigErrorAny(combined);
      const infraFailure = looksLikeReviewInfraFailureAny(combined);
      if (verdictLoose) {
        console.warn("[ai-code-review] 未解析到 verdict，VERDICT_LOOSE=1 已生效");
      } else if (!blockOnFail) {
        console.warn("[ai-code-review] 无法判定 verdict（手动审查，不阻断 git 操作）");
        if (combined?.trim()) console.log(combined);
        return { ok: false, reason: "verdict not parseable (non-blocking)" };
      } else {
        emitReviewFailureBlock({
          bannerTitle: configError
            ? "AI Code Review：配置/鉴权错误"
            : infraFailure
              ? "AI Code Review：服务不可用"
              : "AI Code Review：无法判定",
          introLines: configError
            ? ["[ai-code-review] Provider/API 配置或鉴权错误，请检查 API Key。"]
            : infraFailure
              ? [
                  "[ai-code-review] 审查服务暂时不可用（网络/配额），非代码 FAIL。",
                  "[ai-code-review] 可切换 Agent/Provider，或临时设置 AI_CODE_REVIEW_SOFT_CLI=1 / AI_CODE_REVIEW_VERDICT_LOOSE=1。",
                ]
              : ["[ai-code-review] 输出中缺少有效的 AI_CODE_REVIEW_VERDICT: PASS 或 FAIL。"],
          combined,
          summaryVerdict: null,
          transcriptHeading: "----- 完整输出 -----",
          footerLines: [
            `完整记录：${reportPath}`,
            "宽松模式：AI_CODE_REVIEW_VERDICT_LOOSE=1",
            "临时放行：AI_CODE_REVIEW_SOFT_CLI=1",
          ],
          baseline,
        });
        return { ok: false, reason: "verdict not parseable" };
      }
    }
  }

  if (blockOnFail) {
    console.log(`[ai-code-review] 结论：${verdict ?? "PASS"}，允许继续 git 操作。完整报告：${reportPath}`);
  } else if (combined?.trim()) {
    console.log(combined);
  }
  return { ok: true };
}

async function handleBackendFailure(
  repoRoot: string,
  combined: string,
  label: string,
  baseline: string,
  blockOnFail: boolean,
  detail: string,
  batchCtx?: { batchIndex: number; batchTotal: number; priorVerdicts: Verdict[] }
): Promise<ReviewResult> {
  const softCli = process.env.AI_CODE_REVIEW_SOFT_CLI === "1";
  const reportPath = reviewReportPath(repoRoot);
  writeLastReport(repoRoot, combined || "(no output)", label, baseline);

  const batchVerdict = parseReviewVerdict(combined);
  if (batchVerdict === "FAIL") {
    return finalizeReviewOutcome(
      repoRoot,
      combined,
      label,
      baseline,
      blockOnFail,
      "FAIL"
    );
  }

  // cliFail 路径下禁止单批 PASS 上升为整体 PASS（进程异常时输出可能仍含 PASS）

  if (batchCtx?.priorVerdicts.some((v) => v === "FAIL")) {
    return finalizeReviewOutcome(
      repoRoot,
      combined || "(prior batch FAIL)",
      label,
      baseline,
      blockOnFail,
      "FAIL"
    );
  }

  const incompleteBatch =
    batchCtx != null && batchCtx.batchIndex < batchCtx.batchTotal;
  const configError = looksLikeReviewConfigErrorAny(detail, combined);
  const infraFailure = looksLikeReviewInfraFailureAny(detail, combined);

  if (softCli && blockOnFail) {
    console.warn(`[ai-code-review] ${label} ${detail}（SOFT_CLI=1，不阻断 git 操作）`);
    return { ok: true, skipped: true, reason: detail };
  }

  if (!blockOnFail) {
    if (configError || infraFailure || incompleteBatch) {
      console.warn(`[ai-code-review] ${label} ${detail}（手动审查，不阻断 git 操作）`);
    } else {
      console.error(`[ai-code-review] ${label} ${detail}（手动审查，不阻断 git 操作）`);
    }
    return { ok: false, skipped: true, reason: detail };
  }

  const introLines = [`[ai-code-review] ${label} ${detail}。`];
  if (incompleteBatch) {
    introLines.push(
      `[ai-code-review] 分批审查未完成（${batchCtx!.batchIndex}/${batchCtx!.batchTotal} 批），剩余文件未审查。`
    );
  }
  if (configError) {
    introLines.push("[ai-code-review] Provider/API 配置或鉴权错误，请检查 API Key。");
  } else if (infraFailure) {
    introLines.push("[ai-code-review] 审查服务暂时不可用（网络/配额），非代码 FAIL。");
  }

  emitReviewFailureBlock({
    bannerTitle: incompleteBatch
      ? "AI Code Review：审查未完成"
      : configError
        ? "AI Code Review：配置/鉴权错误"
        : infraFailure
          ? "AI Code Review：服务不可用"
          : "AI Code Review：进程异常",
    introLines,
    combined: combined || "(no output)",
    summaryVerdict: batchVerdict,
    transcriptHeading: "----- 完整输出 -----",
    footerLines: [
      `完整记录：${reportPath}`,
      "临时放行：AI_CODE_REVIEW_SOFT_CLI=1",
    ],
    baseline,
  });
  return { ok: false, reason: detail };
}

async function runBatchedFileReview(
  repoRoot: string,
  config: ResolvedRuntimeConfig,
  scope: ReviewScope,
  baseline: string,
  mergeBase: string | undefined,
  changedFiles: string[],
  label: string,
  diffLoadFailed: boolean
): Promise<ReviewResult> {
  const maxDiff = getMaxDiffChars();
  const batches =
    scope === "uncommitted"
      ? splitUncommittedFilesIntoBatches(repoRoot, changedFiles, maxDiff)
      : scope === "staged"
        ? splitStagedFilesIntoBatches(repoRoot, changedFiles, maxDiff)
        : splitFilesIntoBatches(repoRoot, mergeBase!, changedFiles, maxDiff);
  const batchTotal = batches.length;
  const batchReason = diffLoadFailed ? "完整 diff 读取失败" : "diff 超过字符上限";
  const timeoutMs = parsePositiveInt(
    process.env.AI_CODE_REVIEW_TIMEOUT_MS,
    config.timeoutMs
  );
  const estMaxMin = Math.ceil((batchTotal * timeoutMs) / 60000);
  console.log(
    `[ai-code-review] ${batchReason}，将分 ${batchTotal} 批审查（共 ${changedFiles.length} 个文件，预计最长约 ${estMaxMin} 分钟）`
  );

  const sections: string[] = [];
  const verdicts: Verdict[] = [];

  for (let i = 0; i < batches.length; i++) {
    const files = batches[i];
    const batchCtx =
      scope === "uncommitted"
        ? buildUncommittedGitContextForFiles(repoRoot, files, i + 1, batchTotal)
        : scope === "staged"
          ? buildStagedGitContextForFiles(repoRoot, files, i + 1, batchTotal)
          : buildGitContextForFiles(repoRoot, baseline, mergeBase!, files, i + 1, batchTotal);

    if (batchCtx.diffLoadFailed) {
      const msg = `[ai-code-review] 批次 ${i + 1}/${batchTotal} 无法读取 diff`;
      if (!config.blockOnFail) {
        console.warn(msg);
        return { ok: false, skipped: true, reason: "batch diff load failed" };
      }
      emitReviewFailureBlock({
        bannerTitle: "AI Code Review：diff 读取失败",
        introLines: [msg],
        combined: batchCtx.text,
        summaryVerdict: null,
        transcriptHeading: "----- 上下文 -----",
        footerLines: [`完整记录：${reviewReportPath(repoRoot)}`],
        baseline,
      });
      return { ok: false, reason: "batch diff load failed" };
    }
    if (batchCtx.truncated) {
      return emitDiffTruncatedFailure(
        repoRoot,
        baseline,
        label,
        [`[ai-code-review] 批次 ${i + 1}/${batchTotal} diff 超过 ${maxDiff} 字符`],
        batchCtx.text,
        config.blockOnFail
      );
    }

    const prompt = buildReviewPrompt(repoRoot, config.reviewPrompt, batchCtx.text, scope, baseline);
    const run = await runReviewBackend(repoRoot, config, prompt, label, {
      batchIndex: i + 1,
      batchTotal,
      fileCount: files.length,
    });
    if ("error" in run) return run.error;
    if (run.cliFail) {
      return handleBackendFailure(
        repoRoot,
        run.combined,
        label,
        baseline,
        config.blockOnFail,
        run.cliFail.detail,
        { batchIndex: i + 1, batchTotal, priorVerdicts: verdicts }
      );
    }

    const batchVerdict = parseReviewVerdict(run.combined);
    verdicts.push(batchVerdict);
    console.log(
      `[ai-code-review] 批次 ${i + 1}/${batchTotal} 完成，结论：${batchVerdict ?? "（未输出 verdict）"}`
    );
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
    "# AI Code Review 分批汇总",
    "",
    `共 ${batchTotal} 批、${changedFiles.length} 个变更文件。`,
    "",
    sections.join("\n\n---\n\n"),
  ];
  if (overallVerdict) {
    combinedParts.push("", `AI_CODE_REVIEW_VERDICT: ${overallVerdict}`);
  } else {
    combinedParts.push(
      "",
      "（部分批次缺少 AI_CODE_REVIEW_VERDICT: PASS/FAIL，无法汇总为 PASS）"
    );
  }
  return finalizeReviewOutcome(
    repoRoot,
    combinedParts.join("\n"),
    label,
    baseline,
    config.blockOnFail,
    overallVerdict
  );
}

export async function runReview(startDir: string): Promise<ReviewResult> {
  if (isReviewSkipped()) {
    console.log("[ai-code-review] 已跳过审查（SKIP_REVIEW=1）");
    return { ok: true, skipped: true, reason: "skipped by SKIP_REVIEW" };
  }

  const repoRoot = findGitRepoRoot(startDir);
  let config: ResolvedRuntimeConfig;
  try {
    config = resolveRuntimeConfig(repoRoot);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(msg);
    console.error(
      "[ai-code-review] 配置文件损坏，请修复 `.cursor/ai-code-review/config.json` 后重试。"
    );
    if (
      process.env.AI_CODE_REVIEW_SOFT_CLI === "1" &&
      process.env.AI_CODE_REVIEW_FROM_HOOK === "1"
    ) {
      console.warn("[ai-code-review] SOFT_CLI=1，配置文件损坏时跳过审查（不阻断 git 操作）");
      return { ok: true, skipped: true, reason: "config parse error" };
    }
    console.error("[ai-code-review] 临时放行：AI_CODE_REVIEW_SOFT_CLI=1");
    return { ok: false, reason: "config parse error" };
  }

  if (!shouldRunReview(config)) {
    console.log("[ai-code-review] 审查未启用（配置 enabled=false）");
    return { ok: true, skipped: true, reason: "disabled" };
  }

  const scope = config.scope;
  const label = backendLabel(config);
  let baseline = config.baseline;
  let mergeBase: string | undefined;

  if (scope === "branch") {
    const configuredBaseline = config.baseline;
    const resolved = resolveEffectiveBaseline(repoRoot, configuredBaseline);
    if (!resolved.baseline) {
      console.error(
        `[ai-code-review] 未找到可用基线分支，已尝试：${resolved.tried.join("、")}`
      );
      return { ok: false, reason: "baseline not found" };
    }
    baseline = resolved.baseline;
    if (configuredBaseline.trim() === "auto" || !configuredBaseline.trim()) {
      logReviewStatus(`自动选择基线分支：${baseline}`);
    }
    maybeFetchBaseline(repoRoot, baseline, scope);
  } else if (scope === "staged") {
    baseline = "HEAD (staged)";
    console.log("[ai-code-review] 审查范围：暂存区（即将 commit 的内容）");
  } else {
    baseline = "HEAD (uncommitted)";
    console.log("[ai-code-review] 审查范围：未提交变更");
  }

  const ctx =
    scope === "uncommitted"
      ? buildUncommittedGitContext(repoRoot)
      : scope === "staged"
        ? buildStagedGitContext(repoRoot)
        : buildGitContext(repoRoot, baseline);

  if (scope === "branch" && !ctx.ok) {
    console.error(`[ai-code-review] 无法计算 merge-base(HEAD, ${baseline})`);
    return { ok: false, reason: "merge-base failed" };
  }

  if (ctx.isEmpty) {
    console.log(`[ai-code-review] 无变更，跳过审查`);
    return { ok: true, skipped: true, reason: "empty delta" };
  }

  mergeBase = ctx.mergeBase;
  const allChangedFiles =
    scope === "uncommitted"
      ? getUncommittedChangedFiles(repoRoot)
      : scope === "staged"
        ? getStagedChangedFiles(repoRoot)
        : getChangedFiles(repoRoot, mergeBase!);
  const changedFiles = filterReviewableChangedFiles(allChangedFiles);

  if (changedFiles.length === 0) {
    console.log(`[ai-code-review] 无需要审查的源码变更，跳过审查`);
    return { ok: true, skipped: true, reason: "no reviewable files" };
  }

  const totalDiffChars = getTotalDiffCharCount(repoRoot, scope, mergeBase, changedFiles);

  if (shouldUseBatchReview(ctx, changedFiles, totalDiffChars)) {
    return runBatchedFileReview(
      repoRoot,
      config,
      scope,
      baseline,
      mergeBase,
      changedFiles,
      label,
      Boolean(ctx.diffLoadFailed)
    );
  }

  if (ctx.diffLoadFailed) {
    if (!config.blockOnFail) {
      return { ok: false, skipped: true, reason: "diff load failed" };
    }
    console.error("[ai-code-review] 完整 diff 读取失败，无法安全审查");
    return { ok: false, reason: "diff load failed" };
  }

  const reviewCtx =
    scope === "uncommitted"
      ? buildUncommittedGitContextForFiles(repoRoot, changedFiles, 1, 1)
      : scope === "staged"
        ? buildStagedGitContextForFiles(repoRoot, changedFiles, 1, 1)
        : buildGitContextForFiles(repoRoot, baseline, mergeBase!, changedFiles, 1, 1);

  if (reviewCtx.truncated) {
    return emitDiffTruncatedFailure(
      repoRoot,
      baseline,
      label,
      [`[ai-code-review] 源码 diff 超过 ${getMaxDiffChars()} 字符`],
      reviewCtx.text,
      config.blockOnFail
    );
  }

  const prompt = buildReviewPrompt(
    repoRoot,
    config.reviewPrompt,
    reviewCtx.text,
    scope,
    baseline
  );
  const run = await runReviewBackend(repoRoot, config, prompt, label);
  if ("error" in run) return run.error;
  if (run.cliFail) {
    return handleBackendFailure(
      repoRoot,
      run.combined,
      label,
      baseline,
      config.blockOnFail,
      run.cliFail.detail
    );
  }

  return finalizeReviewOutcome(
    repoRoot,
    run.combined,
    label,
    baseline,
    config.blockOnFail
  );
}
