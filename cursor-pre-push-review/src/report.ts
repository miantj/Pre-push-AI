import * as fs from "fs";
import * as path from "path";
import { looksLikeReviewInfraFailure, parseReviewVerdict, Verdict } from "./verdict";

import { REVIEW_REPORT_REL } from "./paths";

export function reviewReportPath(repoRoot: string): string {
  return path.join(repoRoot, REVIEW_REPORT_REL);
}

function formatBeijingTime(date = new Date()): string {
  return date.toLocaleString("sv-SE", { timeZone: "Asia/Shanghai" });
}

function wrapMarkdownFencedCode(content: string): string {
  const s = content == null ? "" : String(content);
  let n = 3;
  let fence: string;
  do {
    fence = "`".repeat(n);
    n += 1;
  } while (s.includes(fence));
  return `${fence}\n${s}\n${fence}`;
}

function clipParagraph(s: string, max: number): string {
  if (!s) return "";
  const t = s.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max).trim()}\n…（已截断，完整内容见下方「Agent 原始输出」）`;
}

/** 子节结束：下一标题 / 分隔 / 结论行 / 字符串末尾（不用 `$`，避免 multiline 下误匹配行尾） */
const SUBSECTION_END =
  "(?=\\n###\\s|\\n##\\s|\\n\\*{3,}\\s*\\n|\\n-{3,}\\s*\\n|^AI_CODE_REVIEW_VERDICT|(?![\\s\\S]))";

function extractSubsection(text: string, h3Pattern: string): string {
  const re = new RegExp(`${h3Pattern}\\s*\\n+([\\s\\S]*?)${SUBSECTION_END}`, "im");
  const m = text.match(re);
  return m ? m[1].trim() : "";
}

function extractSubsectionFirst(text: string, h3Patterns: string[]): string {
  for (const p of h3Patterns) {
    const s = extractSubsection(text, p);
    if (s) return s;
  }
  return "";
}

function extractAllSubsections(text: string, h3Pattern: string): string[] {
  const re = new RegExp(`${h3Pattern}\\s*\\n+([\\s\\S]*?)${SUBSECTION_END}`, "gim");
  const out: string[] = [];
  for (const m of text.matchAll(re)) {
    const s = m[1]?.trim();
    if (s) out.push(s);
  }
  return out;
}

function extractIssueBlocks(text: string): string[] {
  const re =
    /###\s*Issue\s+\d+[^\n]*\n+([\s\S]*?)(?=\n###\s*Issue\s+\d+|\n##\s|\n\*{3,}\s*\n|\n-{3,}\s*\n|^AI_CODE_REVIEW_VERDICT)/gim;
  const out: string[] = [];
  for (const m of text.matchAll(re)) {
    const s = m[1]?.trim();
    if (s) out.push(s);
  }
  return out;
}

function formatFindingBlock(index: number, body: string): string {
  const bugImpact = extractSubsection(body, "###\\s*Bug\\s*&\\s*impact");
  const repro = extractSubsectionFirst(body, [
    "###\\s*Concrete repro[^\\n]*",
    "###\\s*复现[^\\n]*",
    "###\\s*Repro[^\\n]*",
  ]);
  const intent = extractSubsection(body, "###\\s*Intent\\s+vs\\s+code");
  const root = extractSubsectionFirst(body, ["###\\s*Root cause[^\\n]*", "###\\s*根因[^\\n]*"]);
  const fix = extractSubsectionFirst(body, ["###\\s*Minimal fix[^\\n]*", "###\\s*最小修复[^\\n]*"]);
  const validate = extractSubsectionFirst(body, ["###\\s*Validate[^\\n]*", "###\\s*验证[^\\n]*"]);

  const chunks: string[] = [`【问题 ${index}】`];
  if (bugImpact) chunks.push(`■ 影响（Bug & impact）\n${clipParagraph(bugImpact, 720)}`);
  if (repro) chunks.push(`■ 复现（Concrete repro）\n${clipParagraph(repro, 720)}`);
  if (intent) chunks.push(`■ 意图 vs 代码\n${clipParagraph(intent, 520)}`);
  if (root) chunks.push(`■ 根因（路径 / 改动点）\n${clipParagraph(root, 920)}`);
  if (fix) chunks.push(`■ 建议修复\n${clipParagraph(fix, 620)}`);
  if (validate) chunks.push(`■ 如何验证\n${clipParagraph(validate, 620)}`);
  if (chunks.length === 1) {
    chunks.push(`■ 详情\n${clipParagraph(body, 1200)}`);
  }
  return chunks.join("\n\n");
}

export function buildQuickSummary(combined: string, verdict: Verdict, baseline: string): string {
  const raw = (combined || "").trim();
  if (!raw || raw === "(no output)") {
    return "（本次 Agent 无有效文本输出；若不应如此，请检查 agent 是否正常写入 stdout/stderr。）";
  }

  if (verdict === "PASS") {
    return [
      "结论为 PASS。",
      `Agent 认为：相对 ${baseline} 的增量里，没有必须在合并前修复的高严重度缺陷。`,
      "若业务敏感，仍建议快速浏览下方「Agent 原始输出」全文以人工确认。",
    ].join("\n");
  }

  if (!verdict) {
    if (looksLikeReviewInfraFailure(raw)) {
      return [
        "未能解析 AI_CODE_REVIEW_VERDICT：原始输出含 **用量/配额/网络类提示**，**本次未完成代码审查**，不是对当前变更的 PASS/FAIL。",
        "解决办法：① 按 Cursor/Provider 提示切换计费或提高限额；② 换后端（Agent ↔ Provider）；③ 临时放行：`AI_CODE_REVIEW_SOFT_CLI=1` 或 `AI_CODE_REVIEW_VERDICT_LOOSE=1`。",
      ].join("\n");
    }
    return [
      "未能解析 AI_CODE_REVIEW_VERDICT。",
      "输出末尾需要单独一行：`AI_CODE_REVIEW_VERDICT: PASS` 或 `AI_CODE_REVIEW_VERDICT: FAIL`。",
      "若 CLI/Agent 进程异常退出，请查看终端输出或下方「Agent 原始输出」；基础设施类错误见 hook 阻断时的控制台提示。",
    ].join("\n");
  }

  const issueBlocks = extractIssueBlocks(raw);
  if (issueBlocks.length > 0) {
    return issueBlocks.map((block, i) => formatFindingBlock(i + 1, block)).join("\n\n");
  }

  const bugImpacts = extractAllSubsections(raw, "###\\s*Bug\\s*&\\s*impact");
  if (bugImpacts.length > 1) {
    return bugImpacts
      .map((bugImpact, i) => {
        const body = `### Bug & impact\n${bugImpact}`;
        return formatFindingBlock(i + 1, body);
      })
      .join("\n\n");
  }

  const bugImpact = extractSubsection(raw, "###\\s*Bug\\s*&\\s*impact");
  const repro = extractSubsectionFirst(raw, [
    "###\\s*Concrete repro[^\\n]*",
    "###\\s*复现[^\\n]*",
    "###\\s*Repro[^\\n]*",
  ]);
  const intent = extractSubsection(raw, "###\\s*Intent\\s+vs\\s+code");
  const root = extractSubsectionFirst(raw, ["###\\s*Root cause[^\\n]*", "###\\s*根因[^\\n]*"]);
  const fix = extractSubsectionFirst(raw, ["###\\s*Minimal fix[^\\n]*", "###\\s*最小修复[^\\n]*"]);
  const validate = extractSubsectionFirst(raw, ["###\\s*Validate[^\\n]*", "###\\s*验证[^\\n]*"]);

  const chunks: string[] = [];
  if (bugImpact) chunks.push(`■ 影响（Bug & impact）\n${clipParagraph(bugImpact, 720)}`);
  if (repro) chunks.push(`■ 复现（Concrete repro）\n${clipParagraph(repro, 720)}`);
  if (intent) chunks.push(`■ 意图 vs 代码\n${clipParagraph(intent, 520)}`);
  if (root) chunks.push(`■ 根因（路径 / 改动点）\n${clipParagraph(root, 920)}`);
  if (fix) chunks.push(`■ 建议修复\n${clipParagraph(fix, 620)}`);
  if (validate) chunks.push(`■ 如何验证\n${clipParagraph(validate, 620)}`);

  if (chunks.length === 0) {
    return "结论为 FAIL，但未能按常见标题自动拆解。请直接在下方「Agent 原始输出」里查找相关小节。";
  }
  return chunks.join("\n\n");
}

function verdictLabelZh(verdict: Verdict, body: string): string {
  if (verdict === "PASS") return "通过（PASS）";
  if (verdict === "FAIL") return "未通过（FAIL）";
  if (looksLikeReviewInfraFailure(body)) {
    return "未能解析结论行（审查未完成：用量/配额或服务限制）";
  }
  return "未能解析结论行";
}

function pushBehaviorHint(verdict: Verdict, allowIssues: boolean, body: string): string {
  if (allowIssues) return "当前环境：AI_CODE_REVIEW_ALLOW_ISSUES=1，FAIL 时仍可能允许 push（不推荐）。";
  if (verdict === "PASS") return "默认允许继续 git push。";
  if (verdict === "FAIL") return "默认将拦截 git push；修复问题后可再 push。";
  if (looksLikeReviewInfraFailure(body)) {
    return "默认将拦截 git push；此为用量/配额/网络导致审查未跑完。";
  }
  return "默认将拦截 git push（防止漏拦）；可设置 AI_CODE_REVIEW_VERDICT_LOOSE=1 放宽。";
}

export function formatReviewReportFile(
  beijingTime: string,
  combined: string,
  backendLabel: string,
  baseline: string
): string {
  const body = (combined || "").trim() || "(no output)";
  const verdict = parseReviewVerdict(body);
  const allowIssues = process.env.AI_CODE_REVIEW_ALLOW_ISSUES === "1";
  const quick = buildQuickSummary(body, verdict, baseline);
  const fencedAgent = wrapMarkdownFencedCode(body);

  return [
    `# AI Code Review 报告（${backendLabel} · ${baseline}）`,
    "",
    `- **生成时间（北京时间）：** ${beijingTime}`,
    `- **审查结论：** ${verdictLabelZh(verdict, body)}`,
    `- **Push 提示：** ${pushBehaviorHint(verdict, allowIssues, body)}`,
    "",
    "## 1. 先看这里：怎么读",
    "",
    "- 「一眼摘要」：从 Agent 输出里自动抽取影响 / 复现 / 根因 / 修复 / 验证，方便 30 秒扫读。",
    "- 「Agent 原始输出」：完整原文；解析结论请以文末 `AI_CODE_REVIEW_VERDICT:` 行为准。",
    "",
    "## 2. 一眼摘要（自动生成）",
    "",
    quick,
    "",
    "## 3. Agent 原始输出（完整）",
    "",
    fencedAgent,
    "",
  ].join("\n");
}

export function writeLastReport(
  repoRoot: string,
  body: string,
  backendLabel: string,
  baseline: string
): void {
  try {
    fs.mkdirSync(path.join(repoRoot, ".cursor"), { recursive: true });
    const out = reviewReportPath(repoRoot);
    fs.writeFileSync(
      out,
      formatReviewReportFile(formatBeijingTime(), body, backendLabel, baseline),
      "utf8"
    );
  } catch {
    // 不影响 push
  }
}

export function emitReviewFailureBlock(opts: {
  bannerTitle: string;
  introLines: string[];
  combined: string;
  summaryVerdict: Verdict;
  transcriptHeading: string;
  footerLines: string[];
  baseline: string;
}): void {
  console.error(`\n========== ${opts.bannerTitle} ==========`);
  for (const line of opts.introLines) console.error(line);
  console.error("----- 一眼摘要（自动生成）-----");
  console.error(buildQuickSummary(opts.combined, opts.summaryVerdict, opts.baseline));
  console.error(opts.transcriptHeading);
  if (opts.combined?.trim()) {
    console.error(opts.combined);
  } else {
    console.error("[ai-code-review] 未捕获到审查文本输出，请打开报告文件查看。");
  }
  console.error("----- 输出结束 -----\n");
  for (const line of opts.footerLines) console.error(line);
  console.error("==========================================\n");
}
