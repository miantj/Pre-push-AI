# Pre-push AI Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现 Cursor AI 扩展市场的 Pre-push AI Review 插件（npm CLI + Cursor 扩展）

**Architecture:** 双仓库架构：`cursor-pre-push-review` (npm CLI 包) 提供 `cursor-pre-push run` 命令；`cursor-pre-push-vscode` (Cursor 扩展) 提供 UI、hook 管理、报告展示。扩展通过 CLI 调用触发审查。

**Tech Stack:** Node.js, TypeScript, VS Code Extension API, npm

---

## File Structure

```
cursor-pre-push-review/           # npm CLI 包
├── package.json
├── bin/
│   └── cursor-pre-push            # cli bin
├── src/
│   ├── cli.ts                     # CLI 入口
│   ├── reviewer.ts                # 审查逻辑（抽自 bug-review.js）
│   ├── git.ts                     # git merge-base/diff/log
│   ├── verdict.ts                 # 解析 PRE_PUSH_REVIEW_VERDICT
│   └── report.ts                  # 写 .cursor/pre-push-find-bugs-last.md

cursor-pre-push-vscode/            # Cursor 扩展
├── package.json
├── src/
│   ├── extension.ts               # activate/deactivate
│   ├── commands/
│   │   ├── enable.ts              # 为当前工作区启用
│   │   ├── disable.ts             # 禁用审查
│   │   └── runReview.ts           # 立即审查
│   ├── settings/
│   │   └── settingsProvider.ts    # 配置读写
│   ├── views/
│   │   └── reportWebview.ts       # 报告 Webview
│   └── infrastructure/
│       ├── hookInstaller.ts       # 写 hook
│       └── cliRunner.ts           # 调用 CLI
├── resources/
│   └── icon.png
└── README.md
```

---

## Part 1: NPM CLI 包 (cursor-pre-push-review)

### Task 1: 初始化 npm 包

**Files:**
- Create: `cursor-pre-push-review/package.json`

```json
{
  "name": "cursor-pre-push-review",
  "version": "1.0.0",
  "description": "Pre-push AI code review CLI for Cursor",
  "bin": {
    "cursor-pre-push": "./bin/cursor-pre-push"
  },
  "main": "dist/cli.js",
  "scripts": {
    "build": "tsc",
    "prepublishOnly": "npm run build"
  }
}
```

- [ ] **Step 1: Create package.json**

```bash
mkdir -p /Users/mac/Desktop/AI-re-push/cursor-pre-push-review
cat > /Users/mac/Desktop/AI-re-push/cursor-pre-push-review/package.json << 'EOF'
{
  "name": "cursor-pre-push-review",
  "version": "1.0.0",
  "description": "Pre-push AI code review CLI for Cursor",
  "bin": {
    "cursor-pre-push": "./bin/cursor-pre-push"
  },
  "main": "dist/cli.js",
  "scripts": {
    "build": "tsc",
    "prepublishOnly": "npm run build"
  },
  "dependencies": {
    "dotenv": "^16.0.0"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "typescript": "^5.0.0"
  }
}
EOF
```

- [ ] **Step 2: Create tsconfig.json**

```bash
cat > /Users/mac/Desktop/AI-re-push/cursor-pre-push-review/tsconfig.json << 'EOF'
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "commonjs",
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true
  },
  "include": ["src/**/*"]
}
EOF
```

- [ ] **Step 3: Create bin/cursor-pre-push shell script**

```bash
cat > /Users/mac/Desktop/AI-re-push/cursor-pre-push-review/bin/cursor-pre-push << 'EOF'
#!/bin/sh
node "$(dirname "$0")/../dist/cli.js" "$@"
EOF
chmod +x /Users/mac/Desktop/AI-re-push/cursor-pre-push-review/bin/cursor-pre-push
```

- [ ] **Step 4: Commit**

```bash
cd /Users/mac/Desktop/AI-re-push/cursor-pre-push-review
git init
git add package.json tsconfig.json bin/cursor-pre-push
git commit -m "chore: init cursor-pre-push-review npm package"
```

---

### Task 2: 实现 git.ts（git 操作封装）

**Files:**
- Create: `cursor-pre-push-review/src/git.ts`

- [ ] **Step 1: Write git.ts**

```typescript
import { execFileSync } from "child_process";

export interface GitContext {
  ok: boolean;
  text: string;
  mergeBase?: string;
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

  return {
    ok: true,
    mergeBase,
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
```

- [ ] **Step 2: Run build to verify**

```bash
cd /Users/mac/Desktop/AI-re-push/cursor-pre-push-review
npm run build
```

- [ ] **Step 3: Commit**

```bash
git add src/git.ts
git commit -m "feat(git): add git context builder"
```

---

### Task 3: 实现 verdict.ts（解析审查结论）

**Files:**
- Create: `cursor-pre-push-review/src/verdict.ts`

- [ ] **Step 1: Write verdict.ts**

```typescript
export type Verdict = "PASS" | "FAIL" | null;

export function parseReviewVerdict(text: string): Verdict {
  if (!text || typeof text !== "string") return null;
  const re = /PRE_PUSH_REVIEW_VERDICT:\s*(PASS|FAIL)\b/gi;
  const matches = [...text.matchAll(re)];
  if (!matches.length) return null;
  return matches[matches.length - 1][1].toUpperCase() as Verdict;
}

export function looksLikeReviewInfraFailure(text: string): boolean {
  if (!text || typeof text !== "string") return false;
  const t = text.toLowerCase();
  if (t.length > 8000) return false;
  const patterns = [
    /\bout of usage\b/,
    /\b(you're|you are) out of\b/,
    /\bincrease your limit\b/,
    /\brate limit\b/,
    /\bquota exceeded\b/,
    /\b402\b.*\b(payment|billing)\b/,
    /\binvalid api key\b/,
    /\bauthentication failed\b/,
    /\bunauthorized\b.*\b(api|token|key)\b/,
    /用量.*(耗尽|不足)/,
  ];
  return patterns.some((re) => re.test(t));
}
```

- [ ] **Step 2: Run build to verify**

```bash
cd /Users/mac/Desktop/AI-re-push/cursor-pre-push-review
npm run build
```

- [ ] **Step 3: Commit**

```bash
git add src/verdict.ts
git commit -m "feat(verdict): add verdict parser"
```

---

### Task 4: 实现 report.ts（写审查报告）

**Files:**
- Create: `cursor-pre-push-review/src/report.ts`

- [ ] **Step 1: Write report.ts**

```typescript
import * as fs from "fs";
import * as path from "path";

const PRE_PUSH_REPORT_BASENAME = "pre-push-find-bugs-last.md";

export function prePushReportPath(repoRoot: string): string {
  return path.join(repoRoot, ".cursor", PRE_PUSH_REPORT_BASENAME);
}

function formatBeijingTime(date = new Date()): string {
  return date.toLocaleString("sv-SE", { timeZone: "Asia/Shanghai" }).replace(" ", "T") + "+08:00";
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
  return t.slice(0, max).trim() + "\n…（已截断，完整内容见下方「Agent 原始输出」）";
}

function extractSubsection(text: string, h3Pattern: string): string {
  const re = new RegExp(
    `${h3Pattern}\\s*\\n+([\\s\\S]*?)(?=\\n###\\s|\\n##\\s|\\n\\*{3,}\\s*\\n|\\n-{3,}\\s*\\n|^PRE_PUSH_REVIEW_VERDICT)`,
    "im"
  );
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

function buildQuickSummary(combined: string, verdict: "PASS" | "FAIL" | null): string {
  const raw = (combined || "").trim();
  if (!raw || raw === "(no output)") {
    return "（本次 Agent 无有效文本输出；若不应如此，请检查 agent 是否正常写入 stdout/stderr。）";
  }

  if (verdict === "PASS") {
    return [
      "结论为 PASS。",
      "Agent 认为：相对 origin/stable 的增量里，没有必须在合并前修复的高严重度缺陷。",
      "若业务敏感，仍建议快速浏览下方「Agent 原始输出」全文以人工确认。",
    ].join("\n");
  }

  if (!verdict) {
    if (looksLikeReviewInfraFailure(raw)) {
      return [
        "未能解析 PRE_PUSH_REVIEW_VERDICT：原始输出为 **Cursor 用量/配额类提示**（如 out of usage），**本次未完成代码审查**，不是对当前分支的 PASS/FAIL。",
        "解决办法：① 在 Cursor 客户端按提示切换计费/提高限额；② 换后端：`AI_REVIEW_AGENT=claude`（需本机 `claude` CLI）；③ 临时放行：`CURSOR_PRE_PUSH_VERDICT_LOOSE=1 git push`。",
      ].join("\n");
    }
    return [
      "未能解析 PRE_PUSH_REVIEW_VERDICT。",
      "输出末尾需要单独一行：`PRE_PUSH_REVIEW_VERDICT: PASS` 或 `PRE_PUSH_REVIEW_VERDICT: FAIL`。",
      "请先查看下方「Agent 原始输出」是否被截断、或未打印结论行。",
    ].join("\n");
  }

  const bugImpact = extractSubsection(raw, "###\\s*Bug\\s*&\\s*impact");
  const intent = extractSubsection(raw, "###\\s*Intent\\s+vs\\s+code");
  const root = extractSubsectionFirst(raw, ["###\\s*Root cause[^\\n]*", "###\\s*根因[^\\n]*"]);
  const fix = extractSubsectionFirst(raw, ["###\\s*Minimal fix[^\\n]*", "###\\s*最小修复[^\\n]*"]);
  const validate = extractSubsectionFirst(raw, ["###\\s*Validate[^\\n]*", "###\\s*验证[^\\n]*"]);

  const chunks = [];
  if (bugImpact) chunks.push(`■ 影响（Bug & impact）\n${clipParagraph(bugImpact, 720)}`);
  if (intent) chunks.push(`■ 意图 vs 代码\n${clipParagraph(intent, 520)}`);
  if (root) chunks.push(`■ 根因（路径 / 改动点）\n${clipParagraph(root, 920)}`);
  if (fix) chunks.push(`■ 建议修复\n${clipParagraph(fix, 620)}`);
  if (validate) chunks.push(`■ 如何验证\n${clipParagraph(validate, 620)}`);

  if (chunks.length === 0) {
    return "结论为 FAIL，但未能按常见标题自动拆解。请直接在下方「Agent 原始输出」里查找相关小节。";
  }
  return chunks.join("\n\n");
}

function verdictLabelZh(verdict: "PASS" | "FAIL" | null, body: string): string {
  if (verdict === "PASS") return "通过（PASS）";
  if (verdict === "FAIL") return "未通过（FAIL）";
  if (looksLikeReviewInfraFailure(body)) {
    return "未能解析结论行（审查未完成：Cursor 用量/配额或服务限制）";
  }
  return "未能解析结论行";
}

function pushBehaviorHint(verdict: "PASS" | "FAIL" | null, allowIssues: boolean, body: string): string {
  if (allowIssues) return "当前环境：CURSOR_PRE_PUSH_ALLOW_ISSUES=1，FAIL 时仍可能允许 push（不推荐）。";
  if (verdict === "PASS") return "默认允许继续 git push。";
  if (verdict === "FAIL") return "默认将拦截 git push；修复问题后可再 push，或按脚本提示使用 SKIP / ALLOW_ISSUES（紧急）。";
  if (looksLikeReviewInfraFailure(body)) return "默认将拦截 git push；此为用量/配额导致审查未跑完。";
  return "默认将拦截 git push（防止漏拦）；可设置 CURSOR_PRE_PUSH_VERDICT_LOOSE=1 放宽。";
}

import { looksLikeReviewInfraFailure } from "./verdict";

export function formatPrePushReportFile(
  beijingTime: string,
  combined: string,
  backendLabel: string
): string {
  const body = (combined || "").trim() || "(no output)";
  const verdict = parseReviewVerdict(body);
  const allowIssues = process.env.CURSOR_PRE_PUSH_ALLOW_ISSUES === "1";
  const quick = buildQuickSummary(body, verdict);
  const fencedAgent = wrapMarkdownFencedCode(body);

  return [
    `# pre-push 代码审查报告（${backendLabel} · 相对 origin/stable 增量）`,
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

export function writeLastReport(repoRoot: string, body: string, backendLabel: string): void {
  try {
    fs.mkdirSync(path.join(repoRoot, ".cursor"), { recursive: true });
    const out = prePushReportPath(repoRoot);
    const beijingTime = formatBeijingTime();
    fs.writeFileSync(out, formatPrePushReportFile(beijingTime, body, backendLabel), "utf8");
  } catch {
    // 不影响 push
  }
}
```

- [ ] **Step 2: Run build to verify**

```bash
cd /Users/mac/Desktop/AI-re-push/cursor-pre-push-review
npm run build
```

- [ ] **Step 3: Commit**

```bash
git add src/report.ts
git commit -m "feat(report): add report writer"
```

---

### Task 5: 实现 reviewer.ts（审查逻辑）

**Files:**
- Create: `cursor-pre-push-review/src/reviewer.ts`

- [ ] **Step 1: Write reviewer.ts**

```typescript
import { spawnSync } from "child_process";
import * as path from "path";
import { buildGitContext, parsePositiveInt } from "./git";
import { parseReviewVerdict, looksLikeReviewInfraFailure } from "./verdict";
import { writeLastReport } from "./report";

const FIND_BUGS_INSTRUCTIONS = `
You are a read-only pre-push reviewer. **Do not** create or edit files; report only.

## Baseline (vs stable)

- Context below is computed from **origin/stable**: **merge-base(HEAD, origin/stable)..HEAD** = everything this **current branch** changes relative to **stable**, plus the commit list on top of that fork.
- Your job: **understand what this branch is trying to deliver** (from commit messages + the diff: APIs, UI, guards, copy, OpenSpec paths **that appear in the diff**) and check whether the **changed code** correctly implements that intent.
- Do **not** invent requirements; if intent is unclear, say so and only report issues you can still prove from the diff (wrong field, missing guard, obvious regression).

## Goal

Find **bugs in the delta vs stable** that matter for ship quality: data loss, auth/permission mistakes, crashes, wrong writes under normal use, broken contract vs visible spec in the diff, or clear user-facing breakage.

## Scope

- Primary evidence: **git log** and **git diff** blocks below (same merge-base..HEAD range).
- Each finding must tie to **this diff** (paths/lines or new call paths). Code outside diff paths is out of scope unless one sentence explains how **this branch's change** triggers the bug.
- If the diff ends with a truncation notice, do **not** claim critical issues for unseen hunks.

## Confidence

Give a **concrete repro** (user steps or request sequence). No repro → not critical → omit.

## Ignore

Style, naming, hypotheticals without a trigger, low-severity UX.

## Project quirks (not defects — never FAIL on these alone)

- Pre-push AI review runs only when \`USE_AI_REVIEW_ON_PRE_PUSH_HOOK\` is \`true\` / \`1\` / \`yes\` / \`on\`; otherwise the hook skips review (default). **Do not** FAIL on this wiring alone.

## Method

1. Summarize what the branch changes vs stable (data/API/UI flow).
2. Infer requirement from commits + diff only.
3. Check edge cases: empty lists, permissions, errors, async, versioned params—**on changed paths**.

## Output

- **No critical in-scope bug:** short paragraph; include **no critical bugs found**.
- **Has issues:** sort by severity. Per item: **Bug & impact** → **Intent vs code** → **Root cause** (paths / what changed) → **Minimal fix** → **Validate**.

## Machine-readable verdict (required)

After all human-readable text, output **exactly one** line on its **own line** (ASCII only, no code fences):

- If there is **no** in-scope critical/high-severity bug to fix before merge:
  \`PRE_PUSH_REVIEW_VERDICT: PASS\`
- If there **is** at least one such bug (anything you listed under 严重 / critical / high impact with repro):
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

function shouldUseAiReview(): boolean {
  const useRaw = process.env.USE_AI_REVIEW_ON_PRE_PUSH_HOOK;
  if (useRaw == null || String(useRaw).trim() === "") return false;
  const v = String(useRaw).trim().toLowerCase();
  return ["true", "1", "yes", "on"].includes(v);
}

function describeCliSpawnFailure(
  r: ReturnType<typeof spawnSync>,
  bin: string,
  timeoutMs: number
): { detail: string; ret: { ok: boolean; reason: string } } | null {
  if (r.error && (r.error as any).code === "ETIMEDOUT") {
    return { detail: `审查超时（${timeoutMs}ms）`, ret: { ok: false, reason: "timeout" } };
  }
  if (r.error) {
    return { detail: `无法启动（${bin}）：${r.error.message}`, ret: { ok: false, reason: "spawn error" } };
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

export interface ReviewResult {
  ok: boolean;
  skipped?: boolean;
  reason?: string;
}

export function runReview(repoRoot: string, withRebase?: boolean, rebaseBranch?: string): ReviewResult {
  if (!shouldUseAiReview()) {
    console.log("[cursor-pre-push] USE_AI_REVIEW_ON_PRE_PUSH_HOOK 未设置，跳过审查");
    return { ok: true, skipped: true, reason: "USE_AI_REVIEW_ON_PRE_PUSH_HOOK" };
  }

  // Optional rebase
  if (withRebase && rebaseBranch) {
    console.log(`[cursor-pre-push] 执行 git fetch && git rebase origin/${rebaseBranch}`);
    try {
      const { execSync } = require("child_process");
      execSync("git fetch origin", { cwd: repoRoot, stdio: "pipe" });
      execSync(`git rebase origin/${rebaseBranch}`, { cwd: repoRoot, stdio: "pipe" });
    } catch (e) {
      console.error(`[cursor-pre-push] rebase 失败: ${e}`);
      return { ok: false, reason: "rebase failed" };
    }
  }

  const baseline = process.env.CURSOR_PRE_PUSH_BASELINE || "origin/stable";
  const ctx = buildGitContext(repoRoot, baseline);
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
      console.error("[cursor-pre-push] 未找到 claude CLI，设置 CURSOR_PRE_PUSH_ALLOW_MISSING_CLI=1 可跳过");
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
      console.error("[cursor-pre-push] 未找到 agent CLI，设置 CURSOR_PRE_PUSH_ALLOW_MISSING_CLI=1 可跳过");
      return { ok: false, reason: "agent not found" };
    }
    argv = buildCursorAgentArgv(repoRoot, prompt);
    backendLabel = "Cursor Agent";
  }

  const timeoutMs = parsePositiveInt(process.env.CURSOR_PRE_PUSH_TIMEOUT_MS, 900000);
  const softCli = process.env.CURSOR_PRE_PUSH_SOFT_CLI === "1";

  console.log(`[cursor-pre-push] 正在运行 ${backendLabel} 只读审查…`);

  const spawnOpts: any = {
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
  writeLastReport(repoRoot, combined || "(no output)", backendLabel);

  const cliFail = describeCliSpawnFailure(r, bin, timeoutMs);
  if (cliFail) {
    if (softCli) {
      console.error(`[cursor-pre-push] ${backendLabel} ${cliFail.detail}，已跳过审查`);
      return { ok: true, skipped: true, reason: cliFail.detail };
    }
    console.error(`[cursor-pre-push] ${backendLabel} ${cliFail.detail}，终止 push`);
    return { ok: false, reason: cliFail.detail };
  }

  const allowIssues = process.env.CURSOR_PRE_PUSH_ALLOW_ISSUES === "1";
  const verdictLoose = process.env.CURSOR_PRE_PUSH_VERDICT_LOOSE === "1";
  const verdict = parseReviewVerdict(combined);

  if (!allowIssues) {
    if (verdict === "FAIL") {
      console.error("\n========== pre-push 审查：未通过 ==========");
      console.error("[cursor-pre-push] 结论：FAIL。请查看上方一眼摘要或报告文件。");
      return { ok: false, reason: "review FAIL" };
    }
    if (verdict !== "PASS") {
      if (verdictLoose) {
        console.warn("[cursor-pre-push] 未解析到 verdict，VERDICT_LOOSE=1 已生效");
      } else {
        console.error("[cursor-pre-push] 未解析到 verdict，终止 push");
        return { ok: false, reason: "verdict not parseable" };
      }
    }
  }

  if (combined && combined.trim()) {
    console.log(combined);
  }

  return { ok: true };
}
```

- [ ] **Step 2: Run build to verify**

```bash
cd /Users/mac/Desktop/AI-re-push/cursor-pre-push-review
npm run build
```

- [ ] **Step 3: Commit**

```bash
git add src/reviewer.ts
git commit -m "feat(reviewer): add review logic"
```

---

### Task 6: 实现 cli.ts（CLI 入口）

**Files:**
- Create: `cursor-pre-push-review/src/cli.ts`

- [ ] **Step 1: Write cli.ts**

```typescript
#!/usr/bin/env node
import * as path from "path";
import * as fs from "fs";
require("dotenv").config({ path: path.join(process.cwd(), ".env") });
import { runReview } from "./reviewer";

function parseArgs(args: string[]): { withRebase: boolean; rebaseBranch: string } {
  const opts = { withRebase: false, rebaseBranch: "main" };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--with-rebase") {
      opts.withRebase = true;
    } else if (args[i] === "--rebase-branch" && i + 1 < args.length) {
      opts.withRebase = true;
      opts.rebaseBranch = args[++i];
    }
  }
  return opts;
}

if (require.main === module) {
  const repoRoot = process.cwd();
  const args = parseArgs(process.argv.slice(2));

  const result = runReview(repoRoot, args.withRebase, args.rebaseBranch);
  if (!result.ok) {
    process.exit(1);
  }
}
```

- [ ] **Step 2: Run build to verify**

```bash
cd /Users/mac/Desktop/AI-re-push/cursor-pre-push-review
npm run build
```

- [ ] **Step 3: Test CLI help**

```bash
cd /Users/mac/Desktop/AI-re-push/cursor-pre-push-review
node dist/cli.js --help
# 期望输出 usage 信息
```

- [ ] **Step 4: Commit**

```bash
git add src/cli.ts
git commit -m "feat(cli): add CLI entry point"
```

---

## Part 2: Cursor 扩展 (cursor-pre-push-vscode)

### Task 7: 初始化 Cursor 扩展项目

**Files:**
- Create: `cursor-pre-push-vscode/package.json`

- [ ] **Step 1: Create package.json**

```bash
mkdir -p /Users/mac/Desktop/AI-re-push/cursor-pre-push-vscode/src/commands
mkdir -p /Users/mac/Desktop/AI-re-push/cursor-pre-push-vscode/src/settings
mkdir -p /Users/mac/Desktop/AI-re-push/cursor-pre-push-vscode/src/views
mkdir -p /Users/mac/Desktop/AI-re-push/cursor-pre-push-vscode/src/infrastructure
mkdir -p /Users/mac/Desktop/AI-re-push/cursor-pre-push-vscode/resources
```

```json
{
  "name": "cursor-pre-push-vscode",
  "displayName": "Pre-push AI Review",
  "description": "AI-powered pre-push code review for Cursor",
  "version": "1.0.0",
  "publisher": "your-publisher-id",
  "engines": {
    "vscode": "^1.88.0"
  },
  "categories": ["Developer", "Linters"],
  "activationEvents": [],
  "main": "./out/extension.js",
  "contributes": {
    "commands": [
      {
        "command": "cursor.prePush.enable",
        "title": "为当前工作区启用 Pre-push 审查"
      },
      {
        "command": "cursor.prePush.disable",
        "title": "禁用 Pre-push 审查"
      },
      {
        "command": "cursor.prePush.runReview",
        "title": "立即审查当前分支"
      },
      {
        "command": "cursor.prePush.openReport",
        "title": "查看上次审查报告"
      }
    ],
    "configuration": {
      "title": "Pre-push AI Review",
      "properties": {
        "cursorPrePush.enabled": {
          "type": "boolean",
          "default": false,
          "description": "是否启用 Pre-push 审查"
        },
        "cursorPrePush.baseline": {
          "type": "string",
          "default": "origin/stable",
          "description": "diff 对比基线分支"
        },
        "cursorPrePush.agent": {
          "type": "string",
          "default": "cursor",
          "enum": ["cursor", "claude"],
          "description": "审查后端"
        },
        "cursorPrePush.rebaseEnabled": {
          "type": "boolean",
          "default": false,
          "description": "push 前是否执行 rebase"
        },
        "cursorPrePush.rebaseBranch": {
          "type": "string",
          "default": "origin/main",
          "description": "rebase 目标分支"
        },
        "cursorPrePush.timeoutMs": {
          "type": "number",
          "default": 900000,
          "description": "审查超时毫秒"
        }
      }
    }
  },
  "scripts": {
    "vscode:prepublish": "npm run compile",
    "compile": "tsc -p ./",
    "watch": "tsc -watch -p ./"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "@types/vscode": "^1.88.0",
    "typescript": "^5.0.0"
  },
  "dependencies": {
    "cursor-pre-push-review": "^1.0.0"
  }
}
```

- [ ] **Step 2: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "commonjs",
    "outDir": "./out",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 3: Initialize git**

```bash
cd /Users/mac/Desktop/AI-re-push/cursor-pre-push-vscode
git init
git add package.json tsconfig.json
git commit -m "chore: init cursor-pre-push-vscode extension"
```

---

### Task 8: 实现 extension.ts（入口）

**Files:**
- Create: `cursor-pre-push-vscode/src/extension.ts`

- [ ] **Step 1: Write extension.ts**

```typescript
import * as vscode from "vscode";
import { registerEnableCommand } from "./commands/enable";
import { registerDisableCommand } from "./commands/disable";
import { registerRunReviewCommand } from "./commands/runReview";
import { registerOpenReportCommand } from "./commands/openReport";
import { SettingsProvider } from "./settings/settingsProvider";
import { HookInstaller } from "./infrastructure/hookInstaller";
import { updateStatusBar } from "./infrastructure/statusBar";

export function activate(context: vscode.ExtensionContext) {
  const settingsProvider = new SettingsProvider();
  const hookInstaller = new HookInstaller();

  registerEnableCommand(context, settingsProvider, hookInstaller);
  registerDisableCommand(context, settingsProvider, hookInstaller);
  registerRunReviewCommand(context, settingsProvider);
  registerOpenReportCommand(context);

  // Update status bar on activation
  updateStatusBar(settingsProvider);
}

export function deactivate() {}
```

- [ ] **Step 2: Run compile to verify**

```bash
cd /Users/mac/Desktop/AI-re-push/cursor-pre-push-vscode
npm run compile
```

- [ ] **Step 3: Commit**

```bash
git add src/extension.ts
git commit -m "feat: add extension entry point"
```

---

### Task 9: 实现 settingsProvider.ts

**Files:**
- Create: `cursor-pre-push-vscode/src/settings/settingsProvider.ts`

- [ ] **Step 1: Write settingsProvider.ts**

```typescript
import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";

export class SettingsProvider {
  private configRoot: vscode.WorkspaceFolder | undefined;

  constructor() {
    this.configRoot = vscode.workspace.workspaceFolders?.[0];
  }

  get enabled(): boolean {
    return vscode.workspace.getConfiguration("cursorPrePush").get<boolean>("enabled") ?? false;
  }

  get baseline(): string {
    return vscode.workspace.getConfiguration("cursorPrePush").get<string>("baseline") ?? "origin/stable";
  }

  get agent(): string {
    return vscode.workspace.getConfiguration("cursorPrePush").get<string>("agent") ?? "cursor";
  }

  get rebaseEnabled(): boolean {
    return vscode.workspace.getConfiguration("cursorPrePush").get<boolean>("rebaseEnabled") ?? false;
  }

  get rebaseBranch(): string {
    return vscode.workspace.getConfiguration("cursorPrePush").get<string>("rebaseBranch") ?? "origin/main";
  }

  get timeoutMs(): number {
    return vscode.workspace.getConfiguration("cursorPrePush").get<number>("timeoutMs") ?? 900000;
  }

  get workspaceConfigPath(): string | null {
    if (!this.configRoot) return null;
    return path.join(this.configRoot.uri.fsPath, ".cursor", "pre-push-review.json");
  }

  async setEnabled(value: boolean): Promise<void> {
    await vscode.workspace.getConfiguration("cursorPrePush").update("enabled", value, true);
  }
}
```

- [ ] **Step 2: Run compile to verify**

```bash
cd /Users/mac/Desktop/AI-re-push/cursor-pre-push-vscode
npm run compile
```

- [ ] **Step 3: Commit**

```bash
git add src/settings/settingsProvider.ts
git commit -m "feat(settings): add settings provider"
```

---

### Task 10: 实现 hookInstaller.ts

**Files:**
- Create: `cursor-pre-push-vscode/src/infrastructure/hookInstaller.ts`

- [ ] **Step 1: Write hookInstaller.ts**

```typescript
import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

export class HookInstaller {
  private get repoRoot(): string {
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? "";
  }

  private get huskyPath(): string {
    return path.join(this.repoRoot, ".husky");
  }

  private get huskyHookPath(): string {
    return path.join(this.huskyPath, "pre-push");
  }

  private get gitHookPath(): string {
    return path.join(this.repoRoot, ".git", "hooks", "pre-push");
  }

  isHookInstalled(): boolean {
    if (fs.existsSync(this.huskyHookPath)) return true;
    if (fs.existsSync(this.gitHookPath)) return true;
    return false;
  }

  async install(rebaseEnabled: boolean, rebaseBranch: string): Promise<boolean> {
    if (!this.repoRoot) {
      vscode.window.showErrorMessage("未找到工作区根目录");
      return false;
    }

    const hookContent = this.buildHookContent(rebaseEnabled, rebaseBranch);

    // Check existing hook
    const existingPath = fs.existsSync(this.huskyHookPath)
      ? this.huskyHookPath
      : fs.existsSync(this.gitHookPath)
        ? this.gitHookPath
        : null;

    if (existingPath) {
      const choice = await vscode.window.showWarningMessage(
        "已存在 pre-push hook，是否覆盖？",
        "覆盖",
        "取消"
      );
      if (choice !== "覆盖") return false;
    }

    // Prefer .husky/
    let targetPath = this.huskyHookPath;
    if (!fs.existsSync(this.huskyPath)) {
      try {
        fs.mkdirSync(this.huskyPath, { recursive: true });
      } catch {
        // fallback to .git/hooks
        targetPath = this.gitHookPath;
      }
    }

    try {
      fs.writeFileSync(targetPath, hookContent, { encoding: "utf8" });
      fs.chmodSync(targetPath, "755");
      vscode.window.showInformationMessage(`已写入 hook: ${targetPath}`);
      return true;
    } catch (e) {
      vscode.window.showErrorMessage(`写入 hook 失败: ${e}`);
      return false;
    }
  }

  async uninstall(): Promise<boolean> {
    const paths = [this.huskyHookPath, this.gitHookPath].filter((p) => fs.existsSync(p));
    if (paths.length === 0) {
      vscode.window.showInformationMessage("未找到已安装的 hook");
      return true;
    }

    const choice = await vscode.window.showWarningMessage(
      `将删除 ${paths.length} 个 hook 文件，是否继续？`,
      "删除",
      "取消"
    );
    if (choice !== "删除") return false;

    for (const p of paths) {
      try {
        fs.unlinkSync(p);
      } catch (e) {
        vscode.window.showErrorMessage(`删除 ${p} 失败: ${e}`);
      }
    }

    vscode.window.showInformationMessage("已移除 pre-push hook");
    return true;
  }

  private buildHookContent(rebaseEnabled: boolean, rebaseBranch: string): string {
    if (rebaseEnabled) {
      return `#!/bin/sh\ncursor-pre-push run --with-rebase --rebase-branch ${rebaseBranch}\n`;
    }
    return `#!/bin/sh\ncursor-pre-push run\n`;
  }
}
```

- [ ] **Step 2: Run compile to verify**

```bash
cd /Users/mac/Desktop/AI-re-push/cursor-pre-push-vscode
npm run compile
```

- [ ] **Step 3: Commit**

```bash
git add src/infrastructure/hookInstaller.ts
git commit -m "feat(hook): add hook installer"
```

---

### Task 11: 实现 statusBar.ts

**Files:**
- Create: `cursor-pre-push-vscode/src/infrastructure/statusBar.ts`

- [ ] **Step 1: Write statusBar.ts**

```typescript
import * as vscode from "vscode";
import { SettingsProvider } from "../settings/settingsProvider";

let statusBarItem: vscode.StatusBarItem | undefined;

export function updateStatusBar(settingsProvider: SettingsProvider): void {
  if (!statusBarItem) {
    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    statusBarItem.command = "cursor.prePush.openReport";
  }

  const enabled = settingsProvider.enabled;
  const hookInstalled = isHookInstalled(settingsProvider);

  if (!hookInstalled) {
    statusBarItem.text = "$(warning) Pre-push: 未安装 hook";
    statusBarItem.color = "#f0ad4e";
  } else if (!enabled) {
    statusBarItem.text = "$(circle-slash) Pre-push: 已关闭";
    statusBarItem.color = undefined;
  } else {
    statusBarItem.text = "$(check) Pre-push: 已启用";
    statusBarItem.color = "#4fd1c5";
  }

  statusBarItem.show();
}

function isHookInstalled(settingsProvider: SettingsProvider): boolean {
  const { workspace } = vscode;
  const root = workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!root) return false;

  const fs = require("fs");
  const path = require("path");
  return (
    fs.existsSync(path.join(root, ".husky", "pre-push")) ||
    fs.existsSync(path.join(root, ".git", "hooks", "pre-push"))
  );
}
```

- [ ] **Step 2: Run compile to verify**

```bash
cd /Users/mac/Desktop/AI-re-push/cursor-pre-push-vscode
npm run compile
```

- [ ] **Step 3: Commit**

```bash
git add src/infrastructure/statusBar.ts
git commit -m "feat(status): add status bar indicator"
```

---

### Task 12: 实现 cliRunner.ts

**Files:**
- Create: `cursor-pre-push-vscode/src/infrastructure/cliRunner.ts`

- [ ] **Step 1: Write cliRunner.ts**

```typescript
import * as vscode from "vscode";
import { spawn } from "child_process";
import { SettingsProvider } from "../settings/settingsProvider";

export async function runCliReview(settingsProvider: SettingsProvider): Promise<boolean> {
  return new Promise((resolve) => {
    const enabled = settingsProvider.enabled;
    const rebaseEnabled = settingsProvider.rebaseEnabled;
    const rebaseBranch = settingsProvider.rebaseBranch;

    // Build command
    const args = ["run"];
    if (rebaseEnabled) {
      args.push("--with-rebase", "--rebase-branch", rebaseBranch);
    }

    const proc = spawn("cursor-pre-push", args, {
      cwd: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
      env: {
        ...process.env,
        CURSOR_PRE_PUSH_BASELINE: settingsProvider.baseline,
        AI_REVIEW_AGENT: settingsProvider.agent,
        CURSOR_PRE_PUSH_TIMEOUT_MS: String(settingsProvider.timeoutMs),
      },
      shell: true,
    });

    let output = "";
    proc.stdout?.on("data", (data) => {
      output += data.toString();
    });
    proc.stderr?.on("data", (data) => {
      output += data.toString();
    });

    proc.on("close", (code) => {
      if (output) {
        vscode.window.showInformationMessage(output.substring(0, 200));
      }
      resolve(code === 0);
    });

    proc.on("error", (err) => {
      vscode.window.showErrorMessage(`CLI 执行失败: ${err.message}`);
      resolve(false);
    });
  });
}
```

- [ ] **Step 2: Run compile to verify**

```bash
cd /Users/mac/Desktop/AI-re-push/cursor-pre-push-vscode
npm run compile
```

- [ ] **Step 3: Commit**

```bash
git add src/infrastructure/cliRunner.ts
git commit -m "feat(cli): add CLI runner"
```

---

### Task 13: 实现 commands/enable.ts

**Files:**
- Create: `cursor-pre-push-vscode/src/commands/enable.ts`

- [ ] **Step 1: Write enable.ts**

```typescript
import * as vscode from "vscode";
import { SettingsProvider } from "../settings/settingsProvider";
import { HookInstaller } from "../infrastructure/hookInstaller";
import { updateStatusBar } from "../infrastructure/statusBar";

export function registerEnableCommand(
  context: vscode.ExtensionContext,
  settingsProvider: SettingsProvider,
  hookInstaller: HookInstaller
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("cursor.prePush.enable", async () => {
      const rebaseEnabled = settingsProvider.rebaseEnabled;
      const rebaseBranch = settingsProvider.rebaseBranch;

      const success = await hookInstaller.install(rebaseEnabled, rebaseBranch);
      if (success) {
        await settingsProvider.setEnabled(true);
        updateStatusBar(settingsProvider);
        vscode.window.showInformationMessage("已启用 Pre-push 审查");
      }
    })
  );
}
```

- [ ] **Step 2: Run compile to verify**

```bash
cd /Users/mac/Desktop/AI-re-push/cursor-pre-push-vscode
npm run compile
```

- [ ] **Step 3: Commit**

```bash
git add src/commands/enable.ts
git commit -m "feat(command): add enable command"
```

---

### Task 14: 实现 commands/disable.ts

**Files:**
- Create: `cursor-pre-push-vscode/src/commands/disable.ts`

- [ ] **Step 1: Write disable.ts**

```typescript
import * as vscode from "vscode";
import { SettingsProvider } from "../settings/settingsProvider";
import { HookInstaller } from "../infrastructure/hookInstaller";
import { updateStatusBar } from "../infrastructure/statusBar";

export function registerDisableCommand(
  context: vscode.ExtensionContext,
  settingsProvider: SettingsProvider,
  hookInstaller: HookInstaller
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("cursor.prePush.disable", async () => {
      const success = await hookInstaller.uninstall();
      if (success) {
        await settingsProvider.setEnabled(false);
        updateStatusBar(settingsProvider);
        vscode.window.showInformationMessage("已禁用 Pre-push 审查");
      }
    })
  );
}
```

- [ ] **Step 2: Run compile to verify**

```bash
cd /Users/mac/Desktop/AI-re-push/cursor-pre-push-vscode
npm run compile
```

- [ ] **Step 3: Commit**

```bash
git add src/commands/disable.ts
git commit -m "feat(command): add disable command"
```

---

### Task 15: 实现 commands/runReview.ts

**Files:**
- Create: `cursor-pre-push-vscode/src/commands/runReview.ts`

- [ ] **Step 1: Write runReview.ts**

```typescript
import * as vscode from "vscode";
import { SettingsProvider } from "../settings/settingsProvider";
import { runCliReview } from "../infrastructure/cliRunner";

export function registerRunReviewCommand(
  context: vscode.ExtensionContext,
  settingsProvider: SettingsProvider
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("cursor.prePush.runReview", async () => {
      if (!settingsProvider.enabled) {
        const choice = await vscode.window.showWarningMessage(
          "Pre-push 审查未启用，是否立即启用？",
          "启用",
          "取消"
        );
        if (choice !== "启用") return;
        await settingsProvider.setEnabled(true);
      }

      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: "正在执行 Pre-push 审查...",
          cancellable: false,
        },
        async () => {
          const result = await runCliReview(settingsProvider);
          if (result) {
            vscode.commands.executeCommand("cursor.prePush.openReport");
          } else {
            vscode.window.showErrorMessage("审查未通过，请查看报告");
          }
        }
      );
    })
  );
}
```

- [ ] **Step 2: Run compile to verify**

```bash
cd /Users/mac/Desktop/AI-re-push/cursor-pre-push-vscode
npm run compile
```

- [ ] **Step 3: Commit**

```bash
git add src/commands/runReview.ts
git commit -m "feat(command): add run review command"
```

---

### Task 16: 实现 commands/openReport.ts

**Files:**
- Create: `cursor-pre-push-vscode/src/commands/openReport.ts`

- [ ] **Step 1: Write openReport.ts**

```typescript
import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";

export function registerOpenReportCommand(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("cursor.prePush.openReport", async () => {
      const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!root) {
        vscode.window.showErrorMessage("未找到工作区根目录");
        return;
      }

      const reportPath = path.join(root, ".cursor", "pre-push-find-bugs-last.md");
      if (!fs.existsSync(reportPath)) {
        vscode.window.showInformationMessage("暂无审查报告，请先执行审查");
        return;
      }

      const document = await vscode.workspace.openTextDocument(reportPath);
      await vscode.window.showTextDocument(document, { viewColumn: vscode.ViewColumn.One });
    })
  );
}
```

- [ ] **Step 2: Run compile to verify**

```bash
cd /Users/mac/Desktop/AI-re-push/cursor-pre-push-vscode
npm run compile
```

- [ ] **Step 3: Commit**

```bash
git add src/commands/openReport.ts
git commit -m "feat(command): add open report command"
```

---

### Task 17: 实现 reportWebview.ts

**Files:**
- Create: `cursor-pre-push-vscode/src/views/reportWebview.ts`

- [ ] **Step 1: Write reportWebview.ts**

```typescript
import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";

export class ReportWebview {
  public static async show(context: vscode.ExtensionContext): Promise<void> {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!root) return;

    const reportPath = path.join(root, ".cursor", "pre-push-find-bugs-last.md");
    if (!fs.existsSync(reportPath)) {
      vscode.window.showInformationMessage("暂无审查报告");
      return;
    }

    const content = fs.readFileSync(reportPath, "utf8");
    const panel = vscode.window.createWebviewPanel(
      "prePushReport",
      "Pre-push 审查报告",
      vscode.ViewColumn.One,
      { enableScripts: true }
    );

    panel.webview.html = ReportWebview.renderHtml(content);
  }

  private static renderHtml(markdown: string): string {
    // Simple markdown to HTML conversion
    const html = markdown
      .replace(/^# (.*)$/gm, "<h1>$1</h1>")
      .replace(/^## (.*)$/gm, "<h2>$1</h2>")
      .replace(/^### (.*)$/gm, "<h3>$1</h3>")
      .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
      .replace(/`(.*?)`/g, "<code>$1</code>")
      .replace(/\n/g, "<br>");

    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; padding: 20px; }
          h1 { color: #333; }
          pre { background: #f4f4f4; padding: 10px; overflow-x: auto; }
          code { background: #f4f4f4; padding: 2px 5px; }
          strong { color: #c00; }
        </style>
      </head>
      <body>${html}</body>
      </html>
    `;
  }
}
```

- [ ] **Step 2: Run compile to verify**

```bash
cd /Users/mac/Desktop/AI-re-push/cursor-pre-push-vscode
npm run compile
```

- [ ] **Step 3: Commit**

```bash
git add src/views/reportWebview.ts
git commit -m "feat(webview): add report webview"
```

---

### Task 18: 发布配置

**Files:**
- Modify: `cursor-pre-push-vscode/package.json`

- [ ] **Step 1: Update package.json with publisher info**

```bash
# 用户需要替换 publisher 为真实信息
cat > /Users/mac/Desktop/AI-re-push/cursor-pre-push-vscode/package.json << 'PKGJSON'
{
  "name": "cursor-pre-push-vscode",
  "displayName": "Pre-push AI Review",
  "description": "AI-powered pre-push code review for Cursor",
  "version": "1.0.0",
  "publisher": "YOUR-PUBLISHER-ID",
  "engines": {
    "vscode": "^1.88.0"
  },
  "categories": ["Developer", "Linters"],
  "activationEvents": [],
  "main": "./out/extension.js",
  "contributes": {
    "commands": [
      {
        "command": "cursor.prePush.enable",
        "title": "为当前工作区启用 Pre-push 审查"
      },
      {
        "command": "cursor.prePush.disable",
        "title": "禁用 Pre-push 审查"
      },
      {
        "command": "cursor.prePush.runReview",
        "title": "立即审查当前分支"
      },
      {
        "command": "cursor.prePush.openReport",
        "title": "查看上次审查报告"
      }
    ],
    "configuration": {
      "title": "Pre-push AI Review",
      "properties": {
        "cursorPrePush.enabled": {
          "type": "boolean",
          "default": false,
          "description": "是否启用 Pre-push 审查"
        },
        "cursorPrePush.baseline": {
          "type": "string",
          "default": "origin/stable",
          "description": "diff 对比基线分支"
        },
        "cursorPrePush.agent": {
          "type": "string",
          "default": "cursor",
          "enum": ["cursor", "claude"],
          "description": "审查后端"
        },
        "cursorPrePush.rebaseEnabled": {
          "type": "boolean",
          "default": false,
          "description": "push 前是否执行 rebase"
        },
        "cursorPrePush.rebaseBranch": {
          "type": "string",
          "default": "origin/main",
          "description": "rebase 目标分支"
        },
        "cursorPrePush.timeoutMs": {
          "type": "number",
          "default": 900000,
          "description": "审查超时毫秒"
        }
      }
    }
  },
  "scripts": {
    "vscode:prepublish": "npm run compile",
    "compile": "tsc -p ./",
    "watch": "tsc -watch -p ./"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "@types/vscode": "^1.88.0",
    "typescript": "^5.0.0"
  },
  "dependencies": {
    "cursor-pre-push-review": "^1.0.0"
  }
}
PKGJSON
```

- [ ] **Step 2: Commit**

```bash
git add package.json
git commit -m "chore: update package.json for marketplace publish"
```

---

## Verification

验证所有任务已完成：

```bash
# 检查 CLI 包
ls /Users/mac/Desktop/AI-re-push/cursor-pre-push-review/dist/
node /Users/mac/Desktop/AI-re-push/cursor-pre-push-review/dist/cli.js --help

# 检查扩展
ls /Users/mac/Desktop/AI-re-push/cursor-pre-push-vscode/out/

# 运行 TypeScript 编译检查
cd /Users/mac/Desktop/AI-re-push/cursor-pre-push-vscode && npm run compile
```

---

## Spec Coverage

| 规格需求 | 实现任务 |
|----------|----------|
| npm CLI `cursor-pre-push run` | Task 1-6 |
| 扩展设置页 | Task 7, 9 |
| 命令：启用/禁用/立即审查/查看报告 | Task 8, 13-16 |
| hook 写入 | Task 10 |
| 报告 Webview | Task 17 |
| 状态栏 | Task 11 |

---

**Plan complete and saved to `docs/superpowers/plans/2026-05-27-pre-push-ai-review-plan.md`**

**Two execution options:**

1. **Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

2. **Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?