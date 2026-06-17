# AI Code Review（VS Code 扩展）

在 Git push / commit 时自动审查，或用命令面板手动审查代码变更。

完整文档见仓库根目录 [README.md](../README.md) 与 [docs/使用指南.md](../docs/使用指南.md)。

---

## 三步上手

| 步骤 | 操作 |
| --- | --- |
| 1 | 安装 VSIX，重载窗口 |
| 2 | `Cmd+Shift+P` → **AI Code Review: 启用 AI Code Review 自动审查** |
| 3 | `git push`，或 **运行 AI Code Review 自动审查** |

报告位置：`.cursor/ai-code-review-last.md`

---

## 配置在哪看？

启用审查后，项目里会出现：

| 文件 | 给谁看 |
| --- | --- |
| `.cursor/ai-code-review.说明.md` | **普通人看这个** — 用人话解释当前每项配置 |
| `.cursor/ai-code-review/config.json` | 给程序读 — 编辑时有字段提示和中文说明 |
| `.cursor/ai-code-review/prompt.md` | 自定义审查标准 |
| `.cursor/ai-code-review-last.md` | 上次审查报告 |

也可以在 Cursor 里：**设置 → 搜 `AI Code Review`**。建议在**用户 settings** 配好 Provider 默认值（含 `providerPath`、`providerAllowCustomUrl`），每个项目启用审查时自动生效。详见 [使用指南](../docs/使用指南.md#进阶cursor-设置团队推荐)。

---

## 常用命令（Cmd+Shift+P）

| 命令 | 什么时候用 |
| --- | --- |
| **启用 AI Code Review 自动审查** | 每个项目第一次用 |
| **运行 AI Code Review 自动审查** | 不 push 也想先审代码 |
| **查看上次 AI Code Review 自动审查报告** | 看 FAIL 原因 |
| **设置 AI Code Review Provider API Key** | 用 DeepSeek 等 API 时 |
| **安装 AI Code Review Agent CLI 依赖** | 提示找不到 `agent` 时 |
| **打开 AI Code Review Prompt 文件** | 自定义审查规则 |
| **恢复 AI Code Review 默认 Review Prompt** | prompt 改乱了想重置 |
| **禁用 AI Code Review 自动审查** | 关掉自动 hook |

---

## 两种审查方式（二选一）

### 方式 A：Agent 模式（默认）

用本机 Cursor / Claude 命令行，无需 API Key。

```bash
agent --version   # 确认已安装
```

### 方式 B：Provider 模式

用 DeepSeek / MiniMax / OpenAI / **FastGPT 私有化** 等 API。

1. Cursor 用户设置或 `config.json` 里设 `reviewMode: "provider"`，配置 `provider.*`
2. 私有部署（FastGPT）还需：`providerAllowCustomUrl: true`（自动写入 env）
3. `Cmd+Shift+P` → **设置 AI Code Review Provider API Key**（须为 FastGPT **应用 Key**）

> Git hook 自动审查时，Key 与 `ALLOW_CUSTOM` 会同步到 `.cursor/ai-code-review/env`（设置 API Key / 启用审查 / 改 Cursor 设置时自动更新）。

**FastGPT 团队最小配置（用户 settings 配一次）：**

```json
{
  "aiCodeReview.reviewMode": "provider",
  "aiCodeReview.providerType": "codex",
  "aiCodeReview.providerBaseUrl": "https://aipre.yishouapp.com/api",
  "aiCodeReview.providerPath": "/v1/chat/completions",
  "aiCodeReview.providerAllowCustomUrl": true
}
```

---

## 配置速查（人话版）

| 你想… | 改哪个设置 |
| --- | --- |
| 关掉自动审查 | `enabled` = false，或 **禁用审查** |
| 只在 push 前审 | `hooks` = `["pre-push"]`（默认） |
| 提交前也审 | `hooks` = `["pre-push", "pre-commit"]` |
| 不要 hook，只手动审 | `hooks` = `[]` |
| 用 Cursor 还是 Claude | `agent` = cursor / claude |
| 用 API 不用 Agent | `reviewMode` = provider |
| FastGPT 私有部署 | 用户设置 `providerBaseUrl` + `providerPath` + `providerAllowCustomUrl` |
| 审本分支改动 | 手动选「相对目标分支」或 scope=branch |
| 审暂存区 | 手动选 staged，或启用 pre-commit |
| 审未保存的改动 | 手动选「未提交变更」或 scope=uncommitted |
| 自定义审查标准 | 编辑 `prompt.md` |
| 跳过审查直接 push | `SKIP_REVIEW=1 git push` 或别名 `git push-skip` |
| 紧急 push（FAIL 时，仍审查） | `AI_CODE_REVIEW_ALLOW_ISSUES=1 git push` |

---

## 常见问题

**push 没跑审查？**  
是否执行过 **启用审查**，且 `enabled: true`。

**找不到 origin/stable？**  
`baseline` 保持 `auto`，然后 `git fetch origin`。

**Agent 提示 out of usage？**  
换 `agent: claude`，或改用 Provider 模式。
