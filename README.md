# AI Code Review

在 Git push / commit 等 hook 触发前，或手动运行时，对代码变更做**只读、高严重度** AI 审查；发现必须在合并前修复的问题时**拦截 git 操作**。

---

## 文档索引

| 文档 | 适合谁 | 内容 |
| --- | --- | --- |
| [docs/使用指南.md](docs/使用指南.md) | **终端用户** | 安装、配置、日常使用、Provider、跳过审查 |
| [cursor-pre-push-vscode/README.md](cursor-pre-push-vscode/README.md) | 扩展用户 | VSIX 三步上手、命令速查 |
| [docs/架构说明.md](docs/架构说明.md) | 想理解原理的人 | 模块划分、审查流程、判定逻辑 |
| [docs/开发者指南.md](docs/开发者指南.md) | 维护者 | 本地开发、打包、发布 |

---

## 快速开始（用户）

1. 安装 VSIX → 重载窗口 → 确认 `agent --version`（Agent 模式）
2. `Cmd+Shift+P` → **AI Code Review: 启用 AI Code Review 自动审查**（仅装扩展不会自动装 hook）
3. 默认 `baseline: "auto"`（按 stable → dev → main → master 自动选远程分支）
4. `git push` → 自动审查；报告见 `.cursor/ai-code-review-last.md`

---

## 项目结构

```
AI-re-push/
├── cursor-pre-push-review/   # 审查引擎 CLI（ai-code-review）
│   ├── bin/ai-code-review    # 入口脚本
│   └── src/                  # diff 计算、Agent/Provider 调用、报告生成
├── cursor-pre-push-vscode/   # Cursor / VS Code 扩展
│   ├── src/                  # 命令、hook 安装、配置同步、Webview 报告
│   └── schemas/              # config.json JSON Schema（中文提示）
├── scripts/package-vscode.sh # 维护者一键打包 VSIX
└── docs/                     # 用户与开发者文档
```

扩展将 CLI **内置打包进 VSIX**，用户无需单独 `npm install ai-code-review`。

---

## 安装

### 维护者一键打包

```bash
./scripts/package-vscode.sh
```

### 用户安装扩展

1. 获取 `cursor-pre-push-vscode/ai-code-review-vscode-1.1.0.vsix`
2. Cursor → 扩展 → `···` → **从 VSIX 安装**
3. Agent 模式下按提示安装 **Cursor Agent CLI**（`agent`）

---

## 使用方法

详见 **[docs/使用指南.md](docs/使用指南.md)**。

### CLI 命令

```bash
# git hook 模式（fail-closed：FAIL 时 exit 1）
ai-code-review run [--scope branch|staged|uncommitted]

# 手动审查（不阻断 git）
ai-code-review review [--scope branch|staged|uncommitted]
```

各 hook 默认审查范围：

| Hook | 默认 `--scope` | 含义 |
| --- | --- | --- |
| `pre-push` | `branch` | 本分支相对基线分支的累计改动 |
| `pre-commit` / `commit-msg` | `staged` | 暂存区（即将 commit 的内容） |
| `post-merge` | `branch` | merge 后相对基线的改动 |

### Cursor 扩展命令

| 命令 | 说明 |
|------|------|
| AI Code Review: 启用 AI Code Review 自动审查 | 写入配置并安装所选 hook |
| AI Code Review: 禁用 AI Code Review 自动审查 | 移除 hook 并关闭 |
| AI Code Review: 运行 AI Code Review 自动审查 | 选择范围后手动审查 |
| AI Code Review: 查看上次 AI Code Review 自动审查报告 | 打开报告 |
| AI Code Review: 设置 AI Code Review Provider API Key | Provider 模式保存 Key |
| AI Code Review: 安装 AI Code Review Agent CLI 依赖 | 检测/安装 `agent` |
| AI Code Review: 打开 AI Code Review Prompt 文件 | 编辑 `.cursor/ai-code-review/prompt.md` |
| AI Code Review: 查看 AI Code Review 默认 Review Prompt | 预览内置默认 prompt |
| AI Code Review: 恢复 AI Code Review 默认 Review Prompt | 重置 prompt 为默认 |

---

## 配置

启用审查后，项目 `.cursor/` 目录下：

| 文件 | 用途 |
| --- | --- |
| `ai-code-review.说明.md` | **推荐普通人看这个** — 用人话解释当前配置 |
| `ai-code-review-last.md` | 上次审查报告 |
| `ai-code-review/config.json` | 程序读取的配置（编辑时有中文 Schema 提示） |
| `ai-code-review/prompt.md` | 审查 prompt（可自定义） |
| `ai-code-review/env` | Git hook 用的 API Key（Provider 模式） |
| `ai-code-review/hook.sh` | hook 调用的 runner 脚本（扩展自动生成） |

也可在 Cursor **设置 → 搜 AI Code Review** 调整默认值（**首次启用前**）；**启用后只改 `config.json` 和 `prompt.md` 即可**，不必维护 `.vscode/settings.json`。

示例 json（一般保持默认即可）：

```json
{
  "enabled": true,
  "hooks": ["pre-push"],
  "reviewMode": "agent",
  "agent": "cursor",
  "baseline": "auto",
  "defaultScope": "branch",
  "timeoutMs": 900000
}
```

`reviewMode: "provider"` 时可配置 DeepSeek / MiniMax / Codex，无需本地 Agent CLI。

### 环境变量（优先级高于 config.json）

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `AI_CODE_REVIEW_ENABLED` | 启用审查（true/1/yes/on） | 读 json |
| `AI_CODE_REVIEW_MODE` | `agent` / `provider` | 读 json |
| `AI_CODE_REVIEW_AGENT` | `cursor` / `claude` | cursor |
| `AI_CODE_REVIEW_API_KEY` | Provider API Key | - |
| `AI_CODE_REVIEW_PROVIDER` | `deepseek` / `minimax` / `codex` | 读 json |
| `AI_CODE_REVIEW_PROVIDER_MODEL` | Provider 模型名 | 读 json |
| `AI_CODE_REVIEW_PROVIDER_BASE_URL` | Provider API 根地址 | 读 json |
| `AI_CODE_REVIEW_PROVIDER_PATH` | Provider API 路径 | 读 json |
| `AI_CODE_REVIEW_BASELINE` | diff 基线 | auto |
| `AI_CODE_REVIEW_SCOPE` | `branch` / `staged` / `uncommitted` | 读 json |
| `AI_CODE_REVIEW_TIMEOUT_MS` | 超时毫秒 | 900000 |
| `AI_CODE_REVIEW_AGENT_BIN` | 自定义 `agent` 可执行文件路径 | PATH 查找 |
| `AI_CODE_REVIEW_CLAUDE_BIN` | 自定义 `claude` 可执行文件路径 | PATH 查找 |
| `AI_CODE_REVIEW_CLAUDE_MODEL` | Claude 审查模型 | 默认 |
| `SKIP_REVIEW` | **跳过审查**（1），直接 push | 正常审查 |
| `AI_CODE_REVIEW_ALLOW_ISSUES` | 仍审查，FAIL 时放行（1） | 拦截 |
| `AI_CODE_REVIEW_VERDICT_LOOSE` | 无结论行时放行（1） | 拦截 |
| `AI_CODE_REVIEW_SOFT_CLI` | CLI/Agent 异常不拦（1） | 拦截 |
| `AI_CODE_REVIEW_ALLOW_MISSING_CLI` | CLI 缺失时跳过（1） | 拦截 |
| `AI_CODE_REVIEW_SKIP_FETCH` | 跳过 `git fetch` 基线（1） | 自动 fetch |
| `AI_CODE_REVIEW_FETCH_TIMEOUT_MS` | fetch 超时毫秒 | 60000 |
| `AI_CODE_REVIEW_MAX_DIFF_CHARS` | 单批 diff 字符上限 | 120000 |
| `AI_CODE_REVIEW_BATCH_REVIEW` | 设为 `0` 禁用分批审查 | 自动分批 |
| `AI_CODE_REVIEW_ALLOW_CUSTOM_PROVIDER_URL` | 允许非白名单自定义 baseUrl（1） | 拦截 |
| `AI_CODE_REVIEW_FROM_HOOK` | hook 模式（1，CLI 自动设置） | 手动不阻断 |

---

## 审查流程

```
git push / commit …
  → hook 触发 ai-code-review run
  → 计算 diff（分支增量 / 暂存区 / 未提交变更）
  → 过大时自动分批审查
  → Agent / Provider 只读审查
  → 解析 AI_CODE_REVIEW_VERDICT: PASS | FAIL
  → PASS：exit 0；FAIL：exit 1 拦截
```

自动跳过的路径：`node_modules/`、`dist/`、`out/`、`package-lock.json`、`.vsix` 等。

---

## 报告

审查报告：`.cursor/ai-code-review-last.md`

报告结构：**一眼摘要**（自动抽取影响/复现/修复）+ **Agent 原始输出**（完整原文）。

---

## 常见问题

**Q: push 没跑审查？**  
未执行「启用审查」，或 `enabled: false`。见 [使用指南](docs/使用指南.md)。

**Q: 想跳过审查直接 push？**

```bash
# 一次性
SKIP_REVIEW=1 git push

# 或配置别名后：git push-skip
git config --global alias.push-skip '!f(){ SKIP_REVIEW=1 git push "$@"; }; f'
```

**Q: 审查 FAIL 但想紧急推送？**（仍会跑审查）

```bash
AI_CODE_REVIEW_ALLOW_ISSUES=1 git push
```

**Q: 提示 out of usage？**  
配额问题不是代码 FAIL；恢复额度或换 `AI_CODE_REVIEW_AGENT=claude` / Provider 模式。

**Q: FastGPT / 私有部署 Provider 失败？**  
须用**应用 Key**（非账户 Key）；`env` 中需有 `AI_CODE_REVIEW_ALLOW_CUSTOM_PROVIDER_URL=1`。详见 [使用指南 — FastGPT 私有化](docs/使用指南.md#fastgpt-私有化团队接入)。

**Q: diff 过大被拦？**  
拆分提交，或增大 `AI_CODE_REVIEW_MAX_DIFF_CHARS`。

---

## 技术栈

- **CLI**: Node.js + TypeScript（包名 `ai-code-review`）
- **扩展**: VS Code Extension API（`ai-code-review`）
- **AI 后端**: Cursor Agent / Claude Code / DeepSeek / MiniMax / Codex
