# Pre-push AI Review

在 `git push` 前自动审查当前分支的增量代码，发现高严重度问题时拦截 push。

---

## 使用步骤

### 1. 安装扩展

1. 获取 `cursor-pre-push-vscode-1.0.0.vsix`
2. Cursor → **扩展** → `...` → **从 VSIX 安装**（或直接拖入 VSIX）

### 2. 确认 Agent 可用（通常自动安装）

扩展安装后会自动检测并尝试安装 Cursor Agent CLI。正常情况下无需手动安装，可在终端确认 `agent` 是否可用：

```bash
agent --version
```

若提示找不到 `agent`，可`Cmd+Shift+P`在命令面板执行 **安装 Pre-push 依赖（Cursor Agent CLI）**，或手动执行：

```bash
curl https://cursor.com/install -fsS | bash
echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.zshrc && source ~/.zshrc
```

### 3. 在项目中启用（必做）

> 仅安装扩展不会自动生效，每个仓库需执行一次。

1. 用 Cursor 打开项目根目录（含 `.git` 的文件夹）
2. `Cmd+Shift+P` → **为当前工作区启用 Pre-push 审查**
3. 若已有 pre-push hook，选 **继续安装**

### 4. 正常使用

```bash
git fetch origin && git push
```

push 前会自动审查；报告见 `.cursor/pre-push-find-bugs-last.md`，也可命令面板 **查看上次审查报告**。

不 push 时想先审查：`Cmd+Shift+P` → **立即审查当前分支**。

---

## 常用命令

| 命令 | 说明 |
| --- | --- |
| 为当前工作区启用 Pre-push 审查 | 安装 hook，开启审查 |
| 禁用 Pre-push 审查 | 关闭审查，保留扩展 |
| 立即审查当前分支 | 不 push，直接审查 |
| 查看上次审查报告 | 打开报告文件 |

---

## 配置（可选）

启用后会生成 `.cursor/pre-push-review.json`，一般保持默认即可：

```json
{
  "enabled": true, //false则禁用审查
  "baseline": "auto",
  "agent": "cursor",
  "timeoutMs": 900000
}
```

`baseline: "auto"` 会自动选择远程基线分支（stable → dev → main → master）。

Cursor 设置中搜索 `Pre-push` 也可修改配置。

---

## 常见问题

**push 没跑审查？** 确认已执行「启用 Pre-push 审查」，且 `.cursor/pre-push-review.json` 中 `"enabled": true`。

**审查 FAIL 但要紧急推送？**

```bash
CURSOR_PRE_PUSH_ALLOW_ISSUES=1 git push
```

**报错找不到 `origin/stable`？** 把 `baseline` 改为 `"auto"`，然后 `git fetch origin` 再 push。
