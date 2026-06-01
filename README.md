# Pre-push AI Review

在 Git push 之前，对当前分支相对基线分支的增量做一次**只读、高严重度缺陷** AI 审查；发现必须在合并前修复的问题时**拦截 push**。

**完整操作步骤与排错** → [docs/使用指南.md](docs/使用指南.md)

---

## 快速开始（用户）

1. 安装 VSIX → 重载窗口 → 确认 `agent --version`
2. `Cmd+Shift+P` → **为当前工作区启用 Pre-push 审查**（仅装扩展不会自动装 hook）
3. 默认 `baseline: "auto"`（按 stable → dev → main → master 自动选远程分支）
4. `git push` → 自动审查；报告见 `.cursor/pre-push-find-bugs-last.md`

---

## 安装

审查引擎 `cursor-pre-push-review` **不单独发布 npm**，已随 VSIX 扩展打包。用户只需安装扩展。

### 维护者一键打包

```bash
./scripts/package-vscode.sh
```

### 用户安装扩展

1. 获取 `cursor-pre-push-vscode/cursor-pre-push-vscode-1.0.0.vsix`
2. Cursor → 扩展 → `···` → **从 VSIX 安装**
3. 按提示安装 **Cursor Agent CLI**（`agent`）

---

## 使用方法

详见 **[docs/使用指南.md](docs/使用指南.md)**（启用 hook、配置基线、报错处理）。

### CLI 命令

```bash
# pre-push hook 模式
cursor-pre-push run

# 手动审查当前分支
cursor-pre-push review
```

### Cursor 扩展命令

| 命令 | 说明 |
|------|------|
| 为当前工作区启用 Pre-push 审查 | 安装 hook 并启用 |
| 禁用 Pre-push 审查 | 移除 hook 并关闭 |
| 立即审查当前分支 | 不 push，直接审查 |
| 查看上次审查报告 | 打开报告文件 |

---

## 配置

### 工作区配置

在项目根目录创建 `.cursor/pre-push-review.json`：

```json
{
  "enabled": true,
  "baseline": "auto",
  "agent": "cursor",
  "timeoutMs": 900000
}
```

`baseline: "auto"` 时自动选用远程分支（取第一个存在的）：**origin/stable** → **origin/dev** → **origin/main** → **origin/master**。也可写死如 `"origin/stable"`，不存在时同样按该顺序回退。

### 环境变量（优先级最高）

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `USE_AI_REVIEW_ON_PRE_PUSH_HOOK` | 启用审查（true/1/yes/on） | false |
| `AI_REVIEW_AGENT` | 审查后端：`cursor` 或 `claude` | cursor |
| `CURSOR_PRE_PUSH_BASELINE` | diff 对比基线；不设则按 stable→dev→main→master | auto |
| `CURSOR_PRE_PUSH_TIMEOUT_MS` | 超时毫秒 | 900000 |
| `CURSOR_PRE_PUSH_SOFT_CLI` | 异常仅告警不拦（1） | 拦截 |
| `CURSOR_PRE_PUSH_ALLOW_MISSING_CLI` | CLI 缺失时跳过（1） | 拦截 |
| `CURSOR_PRE_PUSH_ALLOW_ISSUES` | FAIL 仍放行（1） | 拦截 |
| `CURSOR_PRE_PUSH_VERDICT_LOOSE` | 无结论行时放行（1） | 拦截 |

---

## 审查流程

```
git push
  → pre-push hook 触发
  → 计算 merge-base(HEAD, baseline)..HEAD
  → 调用 Cursor Agent / Claude（只读）
  → 解析 PRE_PUSH_REVIEW_VERDICT: PASS | FAIL
  → PASS：exit 0，push 继续
  → FAIL：exit 1，push 中止
```

---

## 报告

审查报告保存在 `.cursor/pre-push-find-bugs-last.md`，包含：

- **一眼摘要**：Bug & impact / 意图 vs 代码 / 根因 / 建议修复 / 验证方法
- **Agent 原始输出**：完整审查内容

---

## 常见问题

**Q: push 没跑审查？**  
未对当前仓库执行「启用 Pre-push 审查」，或 hook / `enabled` 未配置。见 [使用指南 · 第二节](docs/使用指南.md#二在当前项目启用必做)。

**Q: `无法找到远程引用 stable`？**  
将 `baseline` 改为 `"auto"`，或 `git fetch origin` 后见 [使用指南](docs/使用指南.md#2-报错无法找到远程引用-stable--not-a-valid-object-name-originstable)。

**Q: 审查 FAIL 但想紧急推送？**
```bash
CURSOR_PRE_PUSH_ALLOW_ISSUES=1 git push
```

**Q: 提示 out of usage？**
配额问题不是代码 FAIL，恢复额度或换 `AI_REVIEW_AGENT=claude`

---

## 技术栈

- **CLI**: Node.js + TypeScript
- **扩展**: VS Code Extension API + TypeScript
- **AI 后端**: Cursor Agent / Claude Code
