import { AiCodeReviewConfig } from "../settings/settingsProvider";
import { API_KEY_ENV_REL } from "../settings/settingsProvider";
import { PROVIDER_PRESETS } from "./providerPresets";

export const HOOK_LABELS: Record<string, string> = {
  "pre-push": "push 前审查（对比目标分支，默认推荐）",
  "pre-commit": "commit 前审查（只看未提交改动）",
  "commit-msg": "写 commit message 时审查（只看未提交改动）",
  "post-merge": "merge 后审查（对比目标分支）",
};

export const REVIEW_MODE_LABELS: Record<string, string> = {
  agent: "Agent 模式 — 本机 Cursor / Claude CLI（默认）",
  provider: "Provider 模式 — API Key 直连 DeepSeek 等",
};

export const AGENT_LABELS: Record<string, string> = {
  cursor: "Cursor Agent（需安装 agent 命令）",
  claude: "Claude Code（需安装 claude 命令）",
};

export const SCOPE_LABELS: Record<string, string> = {
  branch: "相对目标分支（看本分支改了什么）",
  uncommitted: "未提交变更（看暂存 + 未暂存）",
};

export const PROVIDER_LABELS: Record<string, string> = {
  deepseek: "DeepSeek",
  minimax: "MiniMax",
  codex: "OpenAI Codex / GPT",
};

export function formatTimeoutMs(ms: number): string {
  if (ms >= 60000) return `${Math.round(ms / 60000)} 分钟`;
  return `${Math.round(ms / 1000)} 秒`;
}

function resolveProviderEndpoint(config: AiCodeReviewConfig): string {
  const p = config.provider;
  const preset = PROVIDER_PRESETS[p.type];
  const base = (p.baseUrl || preset.baseUrl).replace(/\/$/, "");
  const apiPath = p.path || preset.path;
  return `${base}${apiPath.startsWith("/") ? apiPath : `/${apiPath}`}`;
}

export function formatHookList(hooks: string[]): string {
  if (!hooks.length) return "不安装 Git hook（仅手动审查）";
  return hooks.map((h) => HOOK_LABELS[h] ?? h).join("；");
}

export function describeConfig(config: AiCodeReviewConfig, promptText = ""): string {
  const lines: string[] = [
    "# AI Code Review 配置说明",
    "",
    "> 本文件由扩展自动生成，与 `.cursor/ai-code-review.json` 同步，已加入 `.gitignore`。",
    "> **只需改 json 里的 `enabled` 等字段即可，不必维护 `.vscode/settings.json`。**",
    "> 改配置：直接编辑 `.cursor/ai-code-review.json`（有字段提示），或看本说明文件。",
    "> 不必在 `.vscode/settings.json` 里重复配置 `aiCodeReview.*`。",
    "",
    "## 快速上手",
    "",
    "| 我想… | 怎么做 |",
    "| --- | --- |",
    "| 第一次用 | `Cmd+Shift+P` → **AI Code Review: 启用审查** |",
    "| 手动审代码 | `Cmd+Shift+P` → **AI Code Review: 运行审查** |",
    "| 改审查 prompt | 编辑 `.cursor/ai-code-review-prompt.md` 或 **打开 Review Prompt 文件** |",
    "| 看上次结果 | `Cmd+Shift+P` → **AI Code Review: 查看上次报告** |",
    "| 用 API 不用 Agent | 设置 `reviewMode` = `provider`，再 **设置 Provider API Key** |",
    "",
    "## 当前配置解读",
    "",
    `### 总开关：${config.enabled ? "✅ 已启用" : "❌ 未启用"}`,
    "",
    config.enabled
      ? "审查会在你配置的 Git hook 或手动运行时执行。"
      : "设为 `false` 时不会自动审查；可仍用手动「运行审查」。",
    "",
    "### 什么时候自动审查？",
    "",
    formatHookList(config.hooks),
    "",
    "可选 hook：`pre-push` | `pre-commit` | `commit-msg` | `post-merge`",
    "设成 `[]` 表示不装 hook，只靠命令面板手动审查。",
    "",
    "### 用什么 AI 审查？",
    "",
    `- **模式：** ${REVIEW_MODE_LABELS[config.reviewMode] ?? config.reviewMode}`,
  ];

  if (config.reviewMode === "agent") {
    lines.push(`- **Agent：** ${AGENT_LABELS[config.agent] ?? config.agent}`);
  } else {
    const preset = PROVIDER_PRESETS[config.provider.type];
    lines.push(
      `- **平台 type：** \`${config.provider.type}\`（${PROVIDER_LABELS[config.provider.type] ?? config.provider.type}）`,
      `- **模型 model：** \`${config.provider.model}\``,
      `- **API 根地址 baseUrl：** ${config.provider.baseUrl ? `\`${config.provider.baseUrl}\`` : `默认 \`${preset.baseUrl}\``}`,
      `- **API 路径 path：** ${config.provider.path ? `\`${config.provider.path}\`` : `默认 \`${preset.path}\``}`,
      `- **实际请求地址：** \`${resolveProviderEndpoint(config)}\``,
      "",
      "**API Key：** 命令面板 → **设置 Provider API Key**（不进 json）。",
      `Git hook 场景还需 ${API_KEY_ENV_REL}：\`AI_CODE_REVIEW_API_KEY=你的key\`。`
    );
  }

  lines.push(
    "",
    "### 审哪部分代码？",
    "",
    `- **手动审查默认范围：** ${SCOPE_LABELS[config.defaultScope] ?? config.defaultScope}`,
    `- **分支对比基线：** \`${config.baseline}\`（\`auto\` = 自动选 stable → dev → main → master）`,
    "",
    "### Review Prompt",
    "",
    "**文件：** `.cursor/ai-code-review-prompt.md`",
    "",
    promptText.trim()
      ? [
          "```",
          promptText.trim().slice(0, 800) +
            (promptText.trim().length > 800 ? "\n...（已截断，完整内容见 prompt 文件）" : ""),
          "```",
          "",
          "编辑：直接改 prompt 文件，或命令 **打开 Review Prompt 文件**。",
          "恢复默认：命令 **恢复默认 Review Prompt**。",
        ].join("\n")
      : [
          "尚未生成 prompt 文件；启用审查或运行审查时会自动写入默认内容。",
        ].join("\n"),
    ""
  );

  if (config.reviewMode === "provider") {
    lines.push(
      "## Provider 模式配置教程",
      "",
      "一次只用 **一个** 模型，在 json 的 `provider` 里配好即可，不必写多个平台。",
      "",
      "### 最小配置（DeepSeek 示例）",
      "",
      "```json",
      '{',
      '  "reviewMode": "provider",',
      '  "provider": {',
      '    "type": "deepseek",',
      '    "model": "deepseek-chat"',
      "  }",
      "}",
      "```",
      "",
      "`baseUrl` / `path` 留空时会按 `type` 自动填平台默认值。",
      "",
      "### 换平台时改什么？",
      "",
      "只改 `provider` 这一段，其它字段不用动：",
      "",
      "| 平台 | type | model 示例 | baseUrl（可选） | path（可选，一般留空） |",
      "| --- | --- | --- | --- | --- |",
      "| DeepSeek | deepseek | deepseek-chat | https://api.deepseek.com | /v1/chat/completions |",
      "| MiniMax 国际 | minimax | MiniMax-Text-01 | https://api.minimax.io | /v1/text/chatcompletion_v2 |",
      "| MiniMax 国内 | minimax | MiniMax-Text-01 | https://api.minimaxi.com | /v1/text/chatcompletion_v2 |",
      "| OpenAI | codex | gpt-4o | https://api.openai.com | /v1/chat/completions |",
      "",
      "### 完整示例（MiniMax 国内）",
      "",
      "```json",
      '{',
      '  "enabled": true,',
      '  "reviewMode": "provider",',
      '  "provider": {',
      '    "type": "minimax",',
      '    "model": "MiniMax-Text-01",',
      '    "baseUrl": "https://api.minimaxi.com",',
      '    "path": "/v1/text/chatcompletion_v2"',
      "  }",
      "}",
      "```",
      "",
      "### API Key",
      "",
      "1. **扩展内手动审查**：命令面板 → **设置 Provider API Key**（存 SecretStorage）",
      `2. **Git hook 自动审查**：在 ${API_KEY_ENV_REL} 写 \`AI_CODE_REVIEW_API_KEY=...\`（hook 读不到 SecretStorage）`,
      ""
    );
  }

  lines.push(
    "## 字段对照表",
    "",
    "| json 字段 | 人话 |",
    "| --- | --- |",
    "| `enabled` | 是否启用 |",
    "| `hooks` | 哪些 Git 操作前自动审查 |",
    "| `reviewMode` | `agent` 本机 CLI / `provider` 云端 API |",
    "| `agent` | Agent 模式用 cursor 还是 claude |",
    "| `provider.type` | 平台：deepseek / minimax / codex |",
    "| `provider.model` | 模型 ID |",
    "| `provider.baseUrl` | API 根地址（可选） |",
    "| `provider.path` | API 路径（可选，与 baseUrl 拼接） |",
    "| `baseline` | 分支审查时跟谁比（通常用 `auto`） |",
    "| `defaultScope` | 手动审查默认选分支还是未提交 |",
    "| `.cursor/ai-code-review-prompt.md` | 实际使用的整段 prompt |",
    "| `timeoutMs` | 单次审查最长等多久 |",
    "",
    "### 其他",
    "",
    `- **超时：** ${formatTimeoutMs(config.timeoutMs)}（\`${config.timeoutMs}\` ms）`,
    ""
  );

  return lines.join("\n");
}
