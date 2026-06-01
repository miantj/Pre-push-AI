# Pre-push AI Review

在 Git push 之前，对当前分支相对基线分支的增量做一次**只读、高严重度缺陷** AI 审查；发现必须在合并前修复的问题时**拦截 push**。

审查引擎已**内置在 VSIX** 中，用户无需单独安装 `cursor-pre-push-review` npm 包。

---

## 快速开始

1. 安装 VSIX → **重载窗口**（`Cmd+Shift+P` → `Developer: Reload Window`）
2. 终端确认 Agent：`agent --version`（未安装见下方「安装 Agent」）
3. `Cmd+Shift+P` → **为当前工作区启用 Pre-push 审查**（**必做**，仅装扩展不会自动写 git hook）
4. 保持 `.cursor/pre-push-review.json` 中 `"baseline": "auto"`
5. `git fetch origin && git push` → 自动审查；报告见 `.cursor/pre-push-find-bugs-last.md`

---

## 安装扩展

### 用户

1. 获取 `cursor-pre-push-vscode-1.0.0.vsix`
2. Cursor → **扩展** → 将 VSIX **拖入**扩展栏
3. **如果当前仓库还没安装 pre-push hook** 需要执行一次：Cmd+Shift+P → 为当前工作区启用 Pre-push 审查
4. 首次启动会尝试自动安装 **Cursor Agent CLI**；也可命令面板执行 **「安装 Pre-push 依赖（Cursor Agent CLI）」**


## 安装 Agent（审查必需）

扩展只负责触发审查，实际 AI 调用依赖本机 **`agent`** 命令：

```bash
curl https://cursor.com/install -fsS | bash
echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.zshrc && source ~/.zshrc
agent --version
```

---

## 在当前项目启用（必做）

1. 用 Cursor **打开项目根目录**（含 `.git` 的文件夹）
2. `Cmd+Shift+P` → **为当前工作区启用 Pre-push 审查**
3. 若 pre-push 里已有其它脚本，选 **继续安装**（在末尾追加审查片段，不删除原有逻辑）

启用成功后应有：

| 文件 | 说明 |
|------|------|
| `.cursor/pre-push-review.json` | 审查开关与基线等配置 |
| `.git/hooks/pre-push` 或 `.husky/pre-push` | 含 `# >>> cursor-pre-push-review` 片段 |

### 自检

```bash
cat .cursor/pre-push-review.json
grep -A3 "cursor-pre-push-review" .git/hooks/pre-push 2>/dev/null
grep -A3 "cursor-pre-push-review" .husky/pre-push 2>/dev/null
```

---

## 扩展命令

| 命令 | 说明 |
|------|------|
| 为当前工作区启用 Pre-push 审查 | 写入配置 + 安装 pre-push hook |
| 禁用 Pre-push 审查 | 移除 hook 片段，关闭审查（**不卸载扩展**） |
| 立即审查当前分支 | 不 push，直接跑一遍审查 |
| 查看上次审查报告 | 打开 `.cursor/pre-push-find-bugs-last.md` |
| 安装 Pre-push 依赖（Cursor Agent CLI） | 安装/检查 `agent` |

---

## 配置

### 工作区文件 `.cursor/pre-push-review.json`

启用审查时会自动创建/更新，也可手改：

```json
{
  "enabled": true,
  "baseline": "auto",
  "agent": "cursor",
  "timeoutMs": 900000
}
```

### 基线分支 `baseline`（重要）

审查对比范围：`merge-base(HEAD, baseline)..HEAD`（当前分支相对基线的增量）。

| 配置值 | 行为 |
|--------|------|
| `"auto"`（**默认**） | 按顺序选用**第一个存在**的远程分支 |
| `"origin/stable"` 等 | 优先使用该分支；**不存在时**仍按下方顺序回退 |

**`auto` 时的优先级：**

1. `origin/stable`
2. `origin/dev`
3. `origin/main`
4. `origin/master`

push 时终端示例：

```text
[cursor-pre-push] 自动选择基线分支：origin/main
```

仅存在 `origin/main` 的仓库会自动选 **main**，无需再手写 `origin/stable`。

### Cursor 设置

设置中搜索 `Pre-push` 可改 `enabled`、`baseline`、`agent`、`timeoutMs` 等。已安装 hook 时，修改会自动同步到 `.cursor/pre-push-review.json`。

### 环境变量（优先级高于 json）

| 变量 | 说明 | 默认 |
|------|------|------|
| `CURSOR_PRE_PUSH_BASELINE` | 对比基线；不设则走 `auto` 回退链 | — |
| `AI_REVIEW_AGENT` | `cursor` 或 `claude` | cursor |
| `CURSOR_PRE_PUSH_TIMEOUT_MS` | 审查超时（毫秒） | 900000 |
| `CURSOR_PRE_PUSH_ALLOW_ISSUES` | `1` = FAIL 仍允许 push | 拦截 |
| `CURSOR_PRE_PUSH_VERDICT_LOOSE` | `1` = 无 verdict 行时放行 | 拦截 |
| `CURSOR_PRE_PUSH_SOFT_CLI` | `1` = CLI 异常仅告警 | 拦截 |
| `CURSOR_PRE_PUSH_ALLOW_MISSING_CLI` | `1` = 缺 CLI 时跳过 | 拦截 |

---

## 审查流程

```
git push
  → pre-push hook 触发（扩展内置 CLI）
  → 解析 baseline（auto 或配置 + 回退）
  → git fetch + merge-base(HEAD, baseline)..HEAD
  → Cursor Agent / Claude 只读审查
  → PRE_PUSH_REVIEW_VERDICT: PASS | FAIL
  → PASS：push 继续；FAIL：push 中止
```

---

## 报告

路径：`.cursor/pre-push-find-bugs-last.md`

- **一眼摘要**：结论与关键问题
- **Agent 原始输出**：完整审查内容

---

## 常见问题

### push 没有任何审查输出？

- **未执行**「为当前工作区启用 Pre-push 审查」
- `.cursor/pre-push-review.json` 里 `"enabled": false`
- 没有 pre-push hook 中的 `cursor-pre-push-review` 片段

→ 重新执行 **启用** 命令，并用上文「自检」确认。

### 报错：`无法找到远程引用 stable` / `Not a valid object name origin/stable`

旧配置写死了不存在的 `origin/stable`。

**处理：**

```bash
git fetch origin
git branch -r
```

将 `baseline` 改为 **`"auto"`**（推荐），然后重新 `git push`。

### 报错：`无法计算 merge-base`

```bash
git fetch origin <分支名>   # 如 main
git merge-base HEAD origin/main
```

确认 `baseline` 与 `git branch -r` 中的远程分支一致。

### 审查 FAIL 但需紧急推送

```bash
CURSOR_PRE_PUSH_ALLOW_ISSUES=1 git push
```

### 提示 out of usage / 配额耗尽

属于 Cursor 账号额度，不是代码审查 FAIL。恢复额度或设置 `AI_REVIEW_AGENT=claude`。

### 「禁用」和「卸载扩展」的区别

| 操作 | 效果 |
|------|------|
| 命令 **禁用 Pre-push 审查** | 只删 hook 片段，扩展仍在「已安装」列表 |
| 扩展面板 **卸载** + **重载窗口** | 完全移除扩展 |

### 卸载后扩展还在列表里？

要点 **卸载（Uninstall）** 而不是 **禁用（Disable）**，然后 **重载窗口**。

---

## 技术说明

- **扩展**：Cursor / VS Code Extension API
- **审查 CLI**：内置 `cursor-pre-push-review`（随 VSIX 打包，不依赖 npm 发布）
- **AI**：Cursor Agent CLI（`agent`）或 Claude Code

更多仓库级说明见根目录 [README.md](../README.md)。
