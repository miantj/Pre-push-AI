"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.prePushReportPath = prePushReportPath;
exports.buildQuickSummary = buildQuickSummary;
exports.formatPrePushReportFile = formatPrePushReportFile;
exports.writeLastReport = writeLastReport;
exports.emitReviewFailureBlock = emitReviewFailureBlock;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const verdict_1 = require("./verdict");
const PRE_PUSH_REPORT_BASENAME = "pre-push-find-bugs-last.md";
function prePushReportPath(repoRoot) {
    return path.join(repoRoot, ".cursor", PRE_PUSH_REPORT_BASENAME);
}
function formatBeijingTime(date = new Date()) {
    return (date.toLocaleString("sv-SE", { timeZone: "Asia/Shanghai" }).replace(" ", "T") +
        "+08:00");
}
function wrapMarkdownFencedCode(content) {
    const s = content == null ? "" : String(content);
    let n = 3;
    let fence;
    do {
        fence = "`".repeat(n);
        n += 1;
    } while (s.includes(fence));
    return `${fence}\n${s}\n${fence}`;
}
function clipParagraph(s, max) {
    if (!s)
        return "";
    const t = s.trim();
    if (t.length <= max)
        return t;
    return `${t.slice(0, max).trim()}\n…（已截断，完整内容见下方「Agent 原始输出」）`;
}
function extractSubsection(text, h3Pattern) {
    const re = new RegExp(`${h3Pattern}\\s*\\n+([\\s\\S]*?)(?=\\n###\\s|\\n##\\s|\\n\\*{3,}\\s*\\n|\\n-{3,}\\s*\\n|^PRE_PUSH_REVIEW_VERDICT)`, "im");
    const m = text.match(re);
    return m ? m[1].trim() : "";
}
function extractSubsectionFirst(text, h3Patterns) {
    for (const p of h3Patterns) {
        const s = extractSubsection(text, p);
        if (s)
            return s;
    }
    return "";
}
function buildQuickSummary(combined, verdict, baseline) {
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
        if ((0, verdict_1.looksLikeReviewInfraFailure)(raw)) {
            return [
                "未能解析 PRE_PUSH_REVIEW_VERDICT：原始输出为 **Cursor 用量/配额类提示**（如 out of usage），**本次未完成代码审查**，不是对当前分支的 PASS/FAIL。",
                "解决办法：① 在 Cursor 客户端按提示切换计费/提高限额；② 换后端：`AI_REVIEW_AGENT=claude`；③ 临时放行：`CURSOR_PRE_PUSH_VERDICT_LOOSE=1 git push`。",
            ].join("\n");
        }
        return [
            "未能解析 PRE_PUSH_REVIEW_VERDICT。",
            "输出末尾需要单独一行：`PRE_PUSH_REVIEW_VERDICT: PASS` 或 `PRE_PUSH_REVIEW_VERDICT: FAIL`。",
        ].join("\n");
    }
    const bugImpact = extractSubsection(raw, "###\\s*Bug\\s*&\\s*impact");
    const intent = extractSubsection(raw, "###\\s*Intent\\s+vs\\s+code");
    const root = extractSubsectionFirst(raw, ["###\\s*Root cause[^\\n]*", "###\\s*根因[^\\n]*"]);
    const fix = extractSubsectionFirst(raw, ["###\\s*Minimal fix[^\\n]*", "###\\s*最小修复[^\\n]*"]);
    const validate = extractSubsectionFirst(raw, ["###\\s*Validate[^\\n]*", "###\\s*验证[^\\n]*"]);
    const chunks = [];
    if (bugImpact)
        chunks.push(`■ 影响（Bug & impact）\n${clipParagraph(bugImpact, 720)}`);
    if (intent)
        chunks.push(`■ 意图 vs 代码\n${clipParagraph(intent, 520)}`);
    if (root)
        chunks.push(`■ 根因（路径 / 改动点）\n${clipParagraph(root, 920)}`);
    if (fix)
        chunks.push(`■ 建议修复\n${clipParagraph(fix, 620)}`);
    if (validate)
        chunks.push(`■ 如何验证\n${clipParagraph(validate, 620)}`);
    if (chunks.length === 0) {
        return "结论为 FAIL，但未能按常见标题自动拆解。请直接在下方「Agent 原始输出」里查找相关小节。";
    }
    return chunks.join("\n\n");
}
function verdictLabelZh(verdict, body) {
    if (verdict === "PASS")
        return "通过（PASS）";
    if (verdict === "FAIL")
        return "未通过（FAIL）";
    if ((0, verdict_1.looksLikeReviewInfraFailure)(body)) {
        return "未能解析结论行（审查未完成：Cursor 用量/配额或服务限制）";
    }
    return "未能解析结论行";
}
function pushBehaviorHint(verdict, allowIssues, body) {
    if (allowIssues)
        return "当前环境：CURSOR_PRE_PUSH_ALLOW_ISSUES=1，FAIL 时仍可能允许 push（不推荐）。";
    if (verdict === "PASS")
        return "默认允许继续 git push。";
    if (verdict === "FAIL")
        return "默认将拦截 git push；修复问题后可再 push。";
    if ((0, verdict_1.looksLikeReviewInfraFailure)(body))
        return "默认将拦截 git push；此为用量/配额导致审查未跑完。";
    return "默认将拦截 git push（防止漏拦）；可设置 CURSOR_PRE_PUSH_VERDICT_LOOSE=1 放宽。";
}
function formatPrePushReportFile(beijingTime, combined, backendLabel, baseline) {
    const body = (combined || "").trim() || "(no output)";
    const verdict = (0, verdict_1.parseReviewVerdict)(body);
    const allowIssues = process.env.CURSOR_PRE_PUSH_ALLOW_ISSUES === "1";
    const quick = buildQuickSummary(body, verdict, baseline);
    const fencedAgent = wrapMarkdownFencedCode(body);
    return [
        `# pre-push 代码审查报告（${backendLabel} · 相对 ${baseline} 增量）`,
        "",
        `- **生成时间（北京时间）：** ${beijingTime}`,
        `- **审查结论：** ${verdictLabelZh(verdict, body)}`,
        `- **Push 提示：** ${pushBehaviorHint(verdict, allowIssues, body)}`,
        "",
        "## 1. 先看这里：怎么读",
        "",
        "- 「一眼摘要」：从 Agent 输出里自动抽取影响 / 根因 / 修复 / 验证，方便 30 秒扫读。",
        "- 「Agent 原始输出」：完整原文；解析结论请以文末 `PRE_PUSH_REVIEW_VERDICT:` 行为准。",
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
function writeLastReport(repoRoot, body, backendLabel, baseline) {
    try {
        fs.mkdirSync(path.join(repoRoot, ".cursor"), { recursive: true });
        const out = prePushReportPath(repoRoot);
        fs.writeFileSync(out, formatPrePushReportFile(formatBeijingTime(), body, backendLabel, baseline), "utf8");
    }
    catch {
        // 不影响 push
    }
}
function emitReviewFailureBlock(opts) {
    console.error(`\n========== ${opts.bannerTitle} ==========`);
    for (const line of opts.introLines)
        console.error(line);
    console.error("----- 一眼摘要（自动生成）-----");
    console.error(buildQuickSummary(opts.combined, opts.summaryVerdict, opts.baseline));
    console.error(opts.transcriptHeading);
    if (opts.combined?.trim()) {
        console.error(opts.combined);
    }
    else {
        console.error("[cursor-pre-push] 未捕获到 Agent 文本输出，请打开报告文件查看。");
    }
    console.error("----- 输出结束 -----\n");
    for (const line of opts.footerLines)
        console.error(line);
    console.error("==========================================\n");
}
