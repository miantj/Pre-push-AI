# AI Code Review

在 Git push / commit 时自动审查，或用命令面板手动审查代码变更。

---

## 三步上手

| 步骤 | 操作 |
| --- | --- |
| 1 | 安装 VSIX，重载窗口 |
| 2 | `Cmd+Shift+P` → **AI Code Review: 启用审查** |
| 3 | `git push`，或 **AI Code Review: 运行审查** |

报告位置：`.cursor/ai-code-review-last.md`

---

## 配置在哪看？

启用审查后，项目里会出现两个文件（**建议先看说明文件**）：

| 文件 | 给谁看 |
| --- | --- |
| `.cursor/ai-code-review.说明.md` | **普通人看这个** — 用人话解释当前每项配置 |
| `.cursor/ai-code-review.json` | 给程序读 — 编辑时有字段提示和中文说明 |

也可以在 Cursor 里：**设置 → 搜 `AI Code Review`**，每项都有中文说明和表格。

---

## 常用命令（Cmd+Shift+P）

| 命令 | 什么时候用 |
| --- | --- |
| **启用审查** | 每个项目第一次用 |
| **运行审查** | 不 push 也想先审代码 |
| **查看上次报告** | 看 FAIL 原因 |
| **设置 Provider API Key** | 用 DeepSeek 等 API 时 |
| **安装 Agent CLI 依赖** | 提示找不到 `agent` 时 |
| **禁用审查** | 关掉自动 hook |

---

## 两种审查方式（二选一）

### 方式 A：Agent 模式（默认）

用本机 Cursor / Claude 命令行，无需 API Key。

```bash
agent --version   # 确认已安装
```

### 方式 B：Provider 模式

用 DeepSeek / MiniMax / OpenAI API。

1. 设置里把 **Review Mode** 改成 `provider`
2. 选 **Provider Type**
3. `Cmd+Shift+P` → **设置 Provider API Key**

> 若同时用 Git hook + Provider，还需在项目 `.env` 写 `AI_CODE_REVIEW_API_KEY=你的key`

---

## 配置速查（人话版）

| 你想… | 改哪个设置 |
| --- | --- |
| 关掉自动审查 | `enabled` = false，或 **禁用审查** |
| 只在 push 前审 | `hooks` = `["pre-push"]`（默认） |
| 不要 hook，只手动审 | `hooks` = `[]` |
| 用 Cursor 还是 Claude | `agent` = cursor / claude |
| 用 API 不用 Agent | `reviewMode` = provider |
| 审本分支改动 | 手动选「相对目标分支」 |
| 审未保存的改动 | 手动选「未提交变更」 |
| 对照 PRD 审业务 | `referenceFiles` 填 md 路径 + 勾选 `businessLogic` 维度 |
| 紧急 push（FAIL 时） | 终端：`AI_CODE_REVIEW_ALLOW_ISSUES=1 git push` |

---

## 常见问题

**push 没跑审查？**  
是否执行过 **启用审查**，且 `enabled: true`。

**找不到 origin/stable？**  
`baseline` 保持 `auto`，然后 `git fetch origin`。

**Agent 提示 out of usage？**  
换 `agent: claude`，或改用 Provider 模式。
