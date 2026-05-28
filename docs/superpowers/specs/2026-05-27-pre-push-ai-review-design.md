# Pre-push AI Review — Cursor 扩展设计与实现规格

> 日期：2026-05-27
> 版本：v1.0

---

## 1. 概述与目标

在 **Git push 之前**，对当前分支相对基线分支的增量做一次**只读、高严重度缺陷** AI 审查；发现必须在合并前修复的问题时**拦截 push**。

发布目标：Cursor AI Extensions Marketplace（cursor.com/extensions）。

---

## 2. 项目结构

### 2.1 双仓库架构

| 仓库 | 说明 |
|------|------|
| `cursor-pre-push-review` (npm) | 审查 CLI，含 `cursor-pre-push run` 命令行入口 |
| `cursor-pre-push-vscode` (扩展) | Cursor 扩展：UI、设置、hook 管理、报告展示 |

扩展依赖 npm 包 `cursor-pre-push-review`。

```
workspace/
├── cursor-pre-push-review/          # npm CLI 包
│   ├── package.json
│   ├── src/
│   │   └── cli.ts                   # CLI 入口，核心审查逻辑（抽自现有 bug-review.js）
│   └── bin/
│       └── cursor-pre-push          # CLI bin
│
└── cursor-pre-push-vscode/          # Cursor 扩展
    ├── package.json
    ├── src/
    │   ├── extension.ts             # activate/deactivate
    │   ├── commands/
    │   │   ├── enable.ts           # 为当前工作区启用 Pre-push 审查
    │   │   ├── disable.ts          # 禁用 Pre-push 审查
    │   │   └── runReview.ts        # 立即审查当前分支
    │   ├── settings/
    │   │   └── settingsProvider.ts # 配置读写
    │   ├── views/
    │   │   └── reportWebview.ts    # 报告 Webview
    │   └── infrastructure/
    │       ├── hookInstaller.ts    # 写 .husky/pre-push 或 .git/hooks/pre-push
    │       └── cliRunner.ts        # 调用 cursor-pre-push run
    ├── resources/
    │   └── icon.png
    └── README.md
```

### 2.2 扩展职责边界

- **图形界面**：设置页、命令面板、报告 Webview
- **hook 管理**：写入/删除 pre-push hook，不做审查逻辑
- **CLI 调用**：通过 `cursor-pre-push run` 触发实际审查

---

## 3. CLI 包（cursor-pre-push-review）

### 3.1 功能

`cursor-pre-push run [--with-rebase] [--rebase-branch <branch>]`

核心逻辑复用手头 `cursor-pre-push-bug-review.js`：
- 计算 `merge-base(HEAD, origin/stable)..HEAD`
- 调用 `agent`（默认）或 `claude` 做审查
- 解析 `PRE_PUSH_REVIEW_VERDICT: PASS|FAIL`
- 写报告到 `.cursor/pre-push-find-bugs-last.md`
- exit 0 = PASS / exit 1 = FAIL

### 3.2 环境变量（兼容现有）

| 变量 | 说明 |
|------|------|
| `USE_AI_REVIEW_ON_PRE_PUSH_HOOK` | 启用审查 |
| `AI_REVIEW_AGENT` | `cursor` 或 `claude` |
| `CURSOR_AGENT_BIN` | agent 路径 |
| `CURSOR_PRE_PUSH_CLAUDE_BIN` | claude 路径 |
| `CURSOR_PRE_PUSH_CLAUDE_MODEL` | claude 模型 |
| `CURSOR_PRE_PUSH_SOFT_CLI=1` | 异常仅告警不拦 |
| `CURSOR_PRE_PUSH_ALLOW_MISSING_CLI=1` | CLI 缺失时跳过 |
| `CURSOR_PRE_PUSH_ALLOW_ISSUES=1` | FAIL 仍放行 |
| `CURSOR_PRE_PUSH_VERDICT_LOOSE=1` | 无结论行时放行 |
| `CURSOR_PRE_PUSH_TIMEOUT_MS` | 超时毫秒 |
| `CURSOR_PRE_PUSH_MAX_DIFF_CHARS` | diff 字符上限 |

### 3.3 特殊 flag（扩展新增）

- `--rebase-branch <branch>`：在审查前执行 `git fetch && git rebase origin/<branch>`
- `--with-rebase`：启用 rebase，等价于 `--rebase-branch origin/main`

---

## 4. Cursor 扩展（cursor-pre-push-vscode）

### 4.1 Settings

| 设置键 | 类型 | 默认 | 说明 |
|--------|------|------|------|
| `cursorPrePush.enabled` | boolean | `false` | 是否启用审查 |
| `cursorPrePush.baseline` | string | `origin/stable` | diff 对比基线 |
| `cursorPrePush.agent` | string | `cursor` | 审查后端 |
| `cursorPrePush.rebaseEnabled` | boolean | `false` | push 前是否 rebase |
| `cursorPrePush.rebaseBranch` | string | `origin/main` | rebase 目标分支 |
| `cursorPrePush.timeoutMs` | number | `900000` | 超时毫秒 |

配置存储：工作区 `.cursor/pre-push-review.json`（优先级最高）。

### 4.2 Commands

| 命令 ID | 名称 | 行为 |
|---------|------|------|
| `cursor.prePush.enable` | 为当前工作区启用 Pre-push 审查 | 写 hook，写入配置 |
| `cursor.prePush.disable` | 禁用 Pre-push 审查 | 删除 hook，恢复配置 |
| `cursor.prePush.runReview` | 立即审查当前分支 | 不 push，直接调用 CLI |
| `cursor.prePush.openReport` | 查看上次审查报告 | 打开 Webview |

### 4.3 Hook 写入

- **优先**：`.husky/pre-push`（需项目有 husky）
- **降级**：`.git/hooks/pre-push`（仅本机）

hook 内容：
```sh
#!/bin/sh
cursor-pre-push run --with-rebase --rebase-branch origin/main
```

写 hook 前提示用户确认，不静默覆盖已有 hook。

### 4.4 报告 Webview

读取 `.cursor/pre-push-find-bugs-last.md`，展示：
- 审查结论（PASS / FAIL）
- 一眼摘要（Bug & impact / Root cause / Minimal fix）
- Agent 原文围栏

### 4.5 状态栏

显示当前仓库是否启用 Pre-push 审查（hook 是否存在 + 设置是否打开）。

---

## 5. 发布与分发

| 渠道 | 说明 |
|------|------|
| Cursor AI Extensions | 主市场发布 |
| npm（CLI 包）| 可选：`npm i -g cursor-pre-push-review` |

---

## 6. MVP 功能清单

- [ ] npm 包 `cursor-pre-push-review` 含 `cursor-pre-push run` CLI
- [ ] 扩展设置页（enabled/baseline/agent/rebase）
- [ ] 命令：**为当前工作区启用 Pre-push 审查**
- [ ] 命令：**禁用 Pre-push 审查**
- [ ] 命令：**立即审查当前分支**
- [ ] 命令：**查看上次审查报告**
- [ ] hook 写入（.husky 或 .git/hooks）
- [ ] 报告 Webview 展示
- [ ] 状态栏指示器

---

## 7. 迁移路径

现有 erpvue 用户：
- 当前：`scripts/pre-push.js` + `.husky/pre-push`
- 未来：安装扩展 → 点启用 → hook 改为 `cursor-pre-push run --with-rebase`

---

## 8. 已知约束

- 扩展安装 ≠ 自动启用（用户需显式点"启用"）
- diff 会发送至 AI 服务，敏感仓库需团队评估
- FAIL 默认拦截 push