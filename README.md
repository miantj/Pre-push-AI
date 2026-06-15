# AI Code Review

在 Git push / commit 等 hook 触发前，或手动运行时，对代码变更做**只读、高严重度** AI 审查；发现必须在合并前修复的问题时**拦截 git 操作**。

**用户操作指南** → [docs/使用指南.md](docs/使用指南.md)

---

## 快速开始（用户）

1. 安装 VSIX → 重载窗口 → 确认 `agent --version`（Agent 模式）
2. `Cmd+Shift+P` → **AI Code Review: 启用 AI Code Review 自动审查**（仅装扩展不会自动装 hook）
3. 默认 `baseline: "auto"`（按 stable → dev → main → master 自动选远程分支）
4. `git push` → 自动审查；报告见 `.cursor/ai-code-review-last.md`

---

## 安装

审查引擎 `ai-code-review` CLI **不单独发布 npm**，已随 VSIX 扩展打包。用户只需安装扩展。

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
# git hook 模式
ai-code-review run [--scope branch|uncommitted]

# 手动审查
ai-code-review review [--scope branch|uncommitted]
```

### Cursor 扩展命令

| 命令 | 说明 |
|------|------|
| AI Code Review: 启用 AI Code Review 自动审查 | 写入配置并安装所选 hook |
| AI Code Review: 禁用 AI Code Review 自动审查 | 移除 hook 并关闭 |
| AI Code Review: 运行 AI Code Review 自动审查 | 选择范围后手动审查 |
| AI Code Review: 查看上次 AI Code Review 自动审查报告 | 打开报告 |
| AI Code Review: 设置 AI Code Review Provider API Key | Provider 模式保存 Key |

---

## 配置

启用审查后，项目 `.cursor/` 目录下：

| 文件 | 用途 |
| --- | --- |
| `ai-code-review.说明.md` | **推荐普通人看这个** — 用人话解释当前配置 |
| `ai-code-review-last.md` | 上次审查报告 |
| `ai-code-review/config.json` | 程序读取的配置（编辑时有中文 Schema 提示） |
| `ai-code-review/prompt.md` | 审查 prompt |
| `ai-code-review/env` | Git hook 用的 API Key（Provider 模式） |

也可在 Cursor **设置 → 搜 AI Code Review** 调整默认值（首次启用前）；**启用后只改 `.cursor/ai-code-review/config.json` 和 `.cursor/ai-code-review/prompt.md` 即可**，不必维护 `.vscode/settings.json`。

审查 prompt 单独存放在 `.cursor/ai-code-review/prompt.md`，命令面板可 **打开 Review Prompt 文件** 直接编辑。

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

### 环境变量（优先级最高）

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `AI_CODE_REVIEW_ENABLED` | 启用审查（true/1/yes/on） | false |
| `AI_CODE_REVIEW_AGENT` | `cursor` / `claude` | cursor |
| `AI_CODE_REVIEW_BASELINE` | diff 基线 | auto |
| `AI_CODE_REVIEW_TIMEOUT_MS` | 超时毫秒 | 900000 |
| `SKIP_REVIEW` | **跳过审查**（1），直接 push | 正常审查 |
| `AI_CODE_REVIEW_ALLOW_ISSUES` | 仍审查，FAIL 时放行（1） | 拦截 |
| `AI_CODE_REVIEW_VERDICT_LOOSE` | 无结论行时放行（1） | 拦截 |
| `AI_CODE_REVIEW_SOFT_CLI` | CLI 异常不拦（1） | 拦截 |
| `AI_CODE_REVIEW_ALLOW_MISSING_CLI` | CLI 缺失跳过（1） | 拦截 |

---

## 审查流程

```
git push / commit …
  → hook 触发 ai-code-review run
  → 计算 diff（分支增量 或 未提交变更）
  → Agent / Provider 只读审查
  → 解析 AI_CODE_REVIEW_VERDICT: PASS | FAIL
  → PASS：exit 0；FAIL：exit 1 拦截
```

---

## 报告

审查报告：`.cursor/ai-code-review-last.md`

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

---

## 技术栈

- **CLI**: Node.js + TypeScript（包名 `ai-code-review`）
- **扩展**: VS Code Extension API（`ai-code-review`）
- **AI 后端**: Cursor Agent / Claude Code / DeepSeek / MiniMax / Codex
