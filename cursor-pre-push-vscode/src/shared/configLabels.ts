import { AiCodeReviewConfig } from "../settings/settingsProvider";
import {
  API_KEY_ENV_REL,
  REVIEW_REPORT_REL,
  WORKSPACE_CONFIG_REL,
  WORKSPACE_PROMPT_REL,
} from "./workspacePaths";
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
  uncommitted: "未提交变更（暂存 + 未暂存 + 新文件）",
  staged: "暂存区变更（即将 commit 的内容）",
};

const HOOK_SCOPE: Record<string, string> = {
  "pre-push": "branch（本分支相对目标分支的增量）",
  "pre-commit": "staged（暂存区）",
  "commit-msg": "staged（暂存区）",
  "post-merge": "branch（merge 后相对目标分支）",
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

function buildGuideIntro(): string[] {
  return [
    "# AI Code Review 使用说明",
    "",
    "在 Git push / commit 等操作前，或手动运行时，对代码变更做 **只读 AI 审查**。发现必须在合并前修复的问题时会 **拦截 git 操作**（手动「运行审查」不拦截 git，但 UI 会如实显示 FAIL）。",
    "",
    `> 本文件由扩展自动生成，与 \`${WORKSPACE_CONFIG_REL}\` 同步，已加入 \`.gitignore\`。`,
    "> **启用后只需改 json 里的字段即可，不必维护 `.vscode/settings.json`。**",
    `> 编辑 \`${WORKSPACE_CONFIG_REL}\` 时鼠标悬停字段可看中文提示。`,
    "",
  ];
}

function buildInstallGuide(): string[] {
  return [
    "## 一、安装与第一次启用",
    "",
    "| 步骤 | 操作 |",
    "| --- | --- |",
    "| 1 | 安装 VSIX 扩展 → **重载窗口** |",
    "| 2 | 打开含 `.git` 的项目根目录 |",
    "| 3 | `Cmd+Shift+P` → **AI Code Review: 启用 AI Code Review 自动审查** |",
    "| 4 | Agent 模式确认本机有 `agent` 或 `claude` 命令；Provider 模式需设置 API Key |",
    "| 5 | 直接 `git push`，或命令面板 **运行 AI Code Review 自动审查** |",
    "",
    "启用后左下角状态栏会显示 `AI Review: cursor (pre-push)` 等状态，点击可打开上次报告。",
    "",
  ];
}

function buildFileStructure(): string[] {
  return [
    "## 二、工作区文件说明",
    "",
    "启用审查后，`.cursor/` 下会出现以下文件（均已 gitignore，**勿提交**）：",
    "",
    "| 文件 / 目录 | 用途 |",
    "| --- | --- |",
    "| `ai-code-review.说明.md` | **本文件** — 用人话解释插件用法与当前配置 |",
    "| `ai-code-review-last.md` | 上次审查报告（PASS / FAIL 详情） |",
    "| `ai-code-review/config.json` | 实际配置，程序与扩展读取 |",
    "| `ai-code-review/prompt.md` | 发给 AI 的审查 prompt，可自定义 |",
    "| `ai-code-review/env` | Provider 模式下 Git hook 读取的环境变量（API Key、私有部署开关等） |",
    "| `ai-code-review/hook.sh` | 扩展自动生成的 hook 调用脚本 |",
    "",
  ];
}

function buildQuickStart(): string[] {
  return [
    "## 三、快速上手",
    "",
    "| 我想… | 怎么做 |",
    "| --- | --- |",
    "| 第一次用 | `Cmd+Shift+P` → **启用 AI Code Review 自动审查** |",
    "| push 前自动审 | 保持默认 `hooks: [\"pre-push\"]`，正常 `git push` |",
    "| 不 push 先审代码 | `Cmd+Shift+P` → **运行 AI Code Review 自动审查** → 选范围 |",
    "| 看上次审查结果 | `Cmd+Shift+P` → **查看上次报告**，或打开 `.cursor/ai-code-review-last.md` |",
    "| 改审查规则 / 关注点 | 编辑 `.cursor/ai-code-review/prompt.md` |",
    "| 关掉自动审查 | `enabled: false`，或 **禁用 AI Code Review 自动审查** |",
    "| 用 API 不用 Agent | `reviewMode: \"provider\"` + **设置 Provider API Key** |",
    "| 跳过审查直接 push | `SKIP_REVIEW=1 git push` 或配置别名 `git push-skip` |",
    "",
  ];
}

function buildCommandsSection(): string[] {
  return [
    "## 四、命令面板速查（Cmd+Shift+P）",
    "",
    "搜索 **AI Code Review** 可见全部命令：",
    "",
    "| 命令 | 什么时候用 |",
    "| --- | --- |",
    "| **启用 AI Code Review 自动审查** | 每个项目第一次用；写入配置并安装 Git hook |",
    "| **禁用 AI Code Review 自动审查** | 移除 hook 片段、关闭总开关 |",
    "| **运行 AI Code Review 自动审查** | 不 push 也想先审；可选 branch / 未提交 / 暂存区 |",
    "| **查看上次 AI Code Review 自动审查报告** | 看 FAIL 原因、问题列表 |",
    "| **设置 AI Code Review Provider API Key** | Provider 模式保存密钥（同时写入 env 供 hook 使用） |",
    "| **安装 AI Code Review Agent CLI 依赖** | 提示找不到 `agent` / `claude` 时 |",
    "| **打开 AI Code Review Prompt 文件** | 编辑审查 prompt |",
    "| **恢复 AI Code Review 默认 Review Prompt** | prompt 改乱了，恢复内置默认 |",
    "",
  ];
}

function buildUsageScenarios(): string[] {
  return [
    "## 五、日常使用场景",
    "",
    "### 5.1 push 前自动审查（默认）",
    "",
    "1. 确认 `enabled: true` 且 `hooks` 含 `\"pre-push\"`",
    "2. 正常 `git push`",
    "3. hook 自动调用审查 CLI，对比本分支与目标分支（`baseline: auto`）",
    "4. **PASS** → push 继续；**FAIL** → push 被拦截，打开报告修复后重试",
    "",
    "### 5.2 手动审查（不阻断 git）",
    "",
    "1. `Cmd+Shift+P` → **运行 AI Code Review 自动审查**",
    "2. 选择审查范围：",
    "",
    "| 范围 | 审什么 | 适用场景 |",
    "| --- | --- | --- |",
    "| **相对目标分支** | merge-base(HEAD, baseline)..HEAD | 本分支整体改了什么，最常用 |",
    "| **未提交变更** | 暂存 + 未暂存 + 新文件 | commit / push 前先自查 |",
    "| **暂存区变更** | `git diff --cached` | 只看即将 commit 的内容 |",
    "",
    "3. 审查过程中状态栏显示进度；完成后 PASS 自动打开报告，FAIL 会提示查看报告",
    "",
    "### 5.3 修改配置",
    "",
    "1. 打开 `.cursor/ai-code-review/config.json` 直接编辑（推荐）",
    "2. 保存后扩展会自动同步 hook；本说明文件也会更新",
    "3. **Cursor 设置**（用户 settings）可配 Provider 默认值；改 `providerAllowCustomUrl` / `reviewMode` 会自动同步 `env`",
    "4. 若 hook 里已有自定义脚本，扩展不会静默覆盖，需手动 **启用审查** 确认安装",
    "",
    "### 5.4 自定义审查 Prompt",
    "",
    `1. 编辑 \`${WORKSPACE_PROMPT_REL}\`，或用命令 **打开 AI Code Review Prompt 文件**`,
    "2. Prompt 为只读审查指令：聚焦高严重度问题，不要求 AI 改代码",
    "3. 恢复内置默认：**恢复 AI Code Review 默认 Review Prompt**",
    "",
  ];
}

function buildHookGuide(hooks: string[]): string[] {
  const lines = [
    "## 六、Git Hook 说明",
    "",
    "在 `config.json` 的 `hooks` 数组中选择自动审查时机：",
    "",
    "| hook | 触发时机 | 审查范围 | 说明 |",
    "| --- | --- | --- | --- |",
  ];
  for (const [hook, label] of Object.entries(HOOK_LABELS)) {
    lines.push(
      `| \`${hook}\` | ${label.split("（")[0]} | ${HOOK_SCOPE[hook] ?? "-"} | ${label} |`
    );
  }
  lines.push(
    "",
    "**常用组合：**",
    "",
    "- 只在 push 前审：`[\"pre-push\"]`（默认，推荐）",
    "- commit 前先审：`[\"pre-commit\"]` 或 `[\"pre-push\", \"pre-commit\"]`",
    "- 不要自动审、只手动：`[]`（不安装 hook）",
    "",
    "Hook 通过 `.cursor/ai-code-review/hook.sh` 调用内置 CLI（本机生成，勿提交）。",
    "",
    "- **config.json 或 hook.sh 未就绪**（新 clone、扩展未启用、runner 写入失败）：跳过审查，不阻断 push，终端会提示在本机运行「启用 AI Code Review」",
    "- **hook.sh 存在但 node / CLI 缺失**：跳过审查并提示错误（不阻断 push；修复依赖后重新启用即可）",
    "",
    "**当前已配置：** " + (hooks.length ? hooks.map((h) => `\`${h}\``).join("、") : "无（仅手动审查）"),
    ""
  );
  return lines;
}

function buildReviewFlow(): string[] {
  return [
    "## 七、审查流程",
    "",
    "```",
    "git push / commit / 手动运行",
    "  → Git hook 或扩展调用 ai-code-review CLI",
    "  → 按 scope 计算 diff（分支增量 / 未提交 / 暂存区）",
    "  → 大 diff 自动分批审查",
    "  → Agent（本机 CLI）或 Provider（API）只读审查",
    "  → 解析 AI_CODE_REVIEW_VERDICT: PASS | FAIL",
    "  → 写入 .cursor/ai-code-review-last.md",
    "  → hook 模式：FAIL → exit 1 拦截 git；手动模式：FAIL 不拦截但 UI 显示失败",
    "```",
    "",
    `报告路径：\`${REVIEW_REPORT_REL}\`。报告含「一眼摘要」和 Agent 完整输出，便于快速定位问题。`,
    "",
  ];
}

function buildAgentProviderGuide(config: AiCodeReviewConfig): string[] {
  const lines = [
    "## 八、两种审查后端",
    "",
    "### 方式 A：Agent 模式（默认）",
    "",
    "使用本机 Cursor Agent CLI 或 Claude Code，无需 API Key，走 Cursor / Claude 订阅额度。",
    "",
    "```bash",
    "agent --version   # Cursor Agent",
    "claude --version  # Claude Code",
    "```",
    "",
    "在 json 中设置：`reviewMode: \"agent\"`，`agent: \"cursor\"` 或 `\"claude\"`。",
    "",
    "### 方式 B：Provider 模式",
    "",
    "使用 DeepSeek / MiniMax / OpenAI 等 API，适合 Agent 额度不足或 CI 场景。",
    "",
    "1. `reviewMode` 改为 `\"provider\"`",
    "2. 配置 `provider.type` 和 `provider.model`",
    "3. `Cmd+Shift+P` → **设置 AI Code Review Provider API Key**",
    "",
    "**API Key 存储说明：**",
    "",
    "| 场景 | 密钥存在哪 |",
    "| --- | --- |",
    "| 扩展内手动审查 | VS Code SecretStorage（命令面板设置） |",
    `| Git hook 自动审查 | \`${API_KEY_ENV_REL}\`（hook 读不到 SecretStorage） |`,
    "",
    `设置 API Key 命令会 **同时写入 SecretStorage 和 env 文件**。`,
    "",
    "**Cursor 用户设置（团队推荐，每个项目启用时自动写入 config / env）：**",
    "",
    "| 设置项 | 作用 |",
    "| --- | --- |",
    "| `aiCodeReview.providerBaseUrl` | API 根地址 |",
    "| `aiCodeReview.providerPath` | API 路径 |",
    "| `aiCodeReview.providerAllowCustomUrl` | 私有部署时设为 true，自动写 `ALLOW_CUSTOM=1` 到 env |",
    "",
    "手动编辑 env 时，含特殊字符的 key 请用单引号包裹，例如 `AI_CODE_REVIEW_API_KEY='your-key'`。",
    "",
  ];

  if (config.reviewMode === "agent") {
    lines.push(
      "**当前模式：** Agent — `" + config.agent + "`",
      ""
    );
  }
  return lines;
}

function buildCurrentConfig(config: AiCodeReviewConfig, promptText: string): string[] {
  const lines: string[] = [
    "## 九、当前配置解读",
    "",
    `### 总开关：${config.enabled ? "✅ 已启用" : "❌ 未启用"}`,
    "",
    config.enabled
      ? "审查会在你配置的 Git hook 或手动运行时执行。"
      : "设为 `false` 时不会自动审查；仍可用命令面板手动「运行审查」。",
    "",
    "### 什么时候自动审查？",
    "",
    formatHookList(config.hooks),
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
      `- **实际请求地址：** \`${resolveProviderEndpoint(config)}\``
    );
  }

  lines.push(
    "",
    "### 审哪部分代码？",
    "",
    `- **手动审查默认范围：** ${SCOPE_LABELS[config.defaultScope] ?? config.defaultScope}`,
    `- **分支对比基线：** \`${config.baseline}\`（\`auto\` = 按 stable → dev → main → master 顺序自动选远程分支）`,
    `- **单次超时：** ${formatTimeoutMs(config.timeoutMs)}（\`${config.timeoutMs}\` ms）`,
    "",
    "### Review Prompt 预览",
    "",
    `**文件：** \`${WORKSPACE_PROMPT_REL}\``,
    ""
  );

  if (promptText.trim()) {
    lines.push(
      "```",
      promptText.trim().slice(0, 600) +
        (promptText.trim().length > 600 ? "\n...（已截断，完整内容见 prompt 文件）" : ""),
      "```",
      ""
    );
  } else {
    lines.push("尚未生成 prompt 文件；启用审查或运行审查时会自动写入默认内容。", "");
  }

  return lines;
}

function buildProviderTutorial(): string[] {
  return [
    "## 十、Provider 模式配置教程",
    "",
    "一次只用 **一个** 模型，在 json 的 `provider` 里配好即可。",
    "",
    "### 最小配置（DeepSeek 示例）",
    "",
    "```json",
    "{",
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
    "| 平台 | type | model 示例 | baseUrl（可选） | path（可选） |",
    "| --- | --- | --- | --- | --- |",
    "| DeepSeek | deepseek | deepseek-chat | https://api.deepseek.com | /v1/chat/completions |",
    "| MiniMax 国际 | minimax | MiniMax-M3 | https://api.minimax.io | /v1/text/chatcompletion_v2 |",
    "| MiniMax 国内 | minimax | MiniMax-M3 | https://api.minimaxi.com | /v1/text/chatcompletion_v2 |",
    "| OpenAI | codex | gpt-4o | https://api.openai.com | /v1/chat/completions |",
    "| **FastGPT 私有化** | codex | gpt-4o | https://aipre.yishouapp.com/api | /v1/chat/completions |",
    "",
    "### FastGPT 私有化（团队）",
    "",
    "1. 管理员在用户 settings 配 `providerBaseUrl` / `providerPath` / `providerAllowCustomUrl: true`",
    "2. 每人到 **应用 → 发布渠道 → API 访问** 创建**应用 Key**（`yishouai-xxx`；账户 Key 不可用）",
    "3. `Cmd+Shift+P` → **设置 Provider API Key**",
    "4. 每个新项目 → **启用 AI Code Review 自动审查**",
    "",
    "```json",
    "{",
    '  "reviewMode": "provider",',
    '  "provider": {',
    '    "type": "codex",',
    '    "model": "gpt-4o",',
    '    "baseUrl": "https://aipre.yishouapp.com/api",',
    '    "path": "/v1/chat/completions"',
    "  }",
    "}",
    "```",
    "",
    "### 完整示例（MiniMax 国内）",
    "",
    "```json",
    "{",
    '  "enabled": true,',
    '  "reviewMode": "provider",',
    '  "provider": {',
    '    "type": "minimax",',
    '    "model": "MiniMax-M3",',
    '    "baseUrl": "https://api.minimaxi.com",',
    '    "path": "/v1/text/chatcompletion_v2"',
    "  }",
    "}",
    "```",
    "",
  ];
}

function buildSkipAndEmergency(): string[] {
  return [
    "## 十一、跳过审查与紧急推送",
    "",
    "### 完全不跑审查（推荐日常跳过）",
    "",
    "```bash",
    "SKIP_REVIEW=1 git push",
    "```",
    "",
    "配置 git 别名后长期使用：",
    "",
    "```bash",
    "git config --global alias.push-skip '!f(){ SKIP_REVIEW=1 git push \"$@\"; }; f'",
    "git push-skip          # 之后用法与普通 push 相同",
    "```",
    "",
    "### 仍跑审查，但 FAIL 时不拦截（紧急推送）",
    "",
    "```bash",
    "AI_CODE_REVIEW_ALLOW_ISSUES=1 git push",
    "```",
    "",
    "> `SKIP_REVIEW` = 完全不审查；`ALLOW_ISSUES` = 仍会审查，只是 FAIL 时放行。",
    "",
  ];
}

function buildEnvVars(): string[] {
  return [
    "## 十二、环境变量（高级）",
    "",
    "环境变量优先级高于 json 配置，常用于 CI 或临时调试：",
    "",
    "| 变量 | 说明 | 默认 |",
    "| --- | --- | --- |",
    "| `AI_CODE_REVIEW_ENABLED` | 是否启用 | 读 json |",
    "| `AI_CODE_REVIEW_MODE` | agent / provider | 读 json |",
    "| `AI_CODE_REVIEW_AGENT` | cursor / claude | cursor |",
    "| `AI_CODE_REVIEW_API_KEY` | Provider API Key | - |",
    "| `AI_CODE_REVIEW_ALLOW_CUSTOM_PROVIDER_URL` | 1 = 允许私有部署 baseUrl（FastGPT 等） | - |",
    "| `AI_CODE_REVIEW_BASELINE` | 分支对比基线 | auto |",
    "| `AI_CODE_REVIEW_SCOPE` | branch / uncommitted / staged | 读 json |",
    "| `AI_CODE_REVIEW_TIMEOUT_MS` | 超时毫秒 | 900000 |",
    "| `SKIP_REVIEW` | 1 = 跳过审查 | - |",
    "| `AI_CODE_REVIEW_ALLOW_ISSUES` | 1 = FAIL 仍放行 | - |",
    "| `AI_CODE_REVIEW_FROM_HOOK` | 1 = hook 模式（fail-closed） | CLI 自动设置 |",
    "",
  ];
}

function buildFaq(): string[] {
  return [
    "## 十三、常见问题",
    "",
    "**Q: push 没跑审查？**",
    "→ 是否执行过 **启用 AI Code Review 自动审查**；`enabled` 是否为 `true`；状态栏是否显示已启用。",
    "",
    "**Q: 提示找不到 agent / claude？**",
    "→ 运行 **安装 AI Code Review Agent CLI 依赖**，或改用 Provider 模式。",
    "",
    "**Q: Agent 提示 out of usage / 额度用尽？**",
    "→ 这是配额问题不是代码 FAIL；换 `agent: claude` 或 Provider 模式。",
    "",
    "**Q: Provider 请求失败？**",
    "→ 检查 `provider.type` / `model` / `baseUrl` / `path` 及 API Key 是否有效。FastGPT 须用应用 Key。",
    "",
    "**Q: FastGPT 报 app key rather than account key？**",
    "→ 当前是账户 Key；到具体应用的「发布渠道 → API 访问」创建应用 Key。",
    "",
    "**Q: 私有部署 baseUrl 被忽略？**",
    "→ 确认 env 有 `AI_CODE_REVIEW_ALLOW_CUSTOM_PROVIDER_URL=1`，或 Cursor 设置开启 **允许自定义 Provider API 地址**。",
    "",
    "**Q: 找不到 origin/stable 等基线分支？**",
    "→ `baseline` 保持 `auto`，执行 `git fetch origin` 拉取远程分支。",
    "",
    "**Q: hook 里已有 husky 等自定义脚本？**",
    "→ 扩展会在末尾追加审查片段；若已有外来逻辑，**启用审查** 时会弹确认框，自动同步不会静默覆盖。",
    "",
    "**Q: 审查 FAIL 但问题不认可？**",
    "→ 查看报告中的「Agent 原始输出」；可调整 prompt 或临时 `AI_CODE_REVIEW_ALLOW_ISSUES=1 git push`。",
    "",
    "**Q: 如何完全卸载？**",
    "→ **禁用 AI Code Review 自动审查**；`.cursor/ai-code-review/` 下文件可手动删除（均在 gitignore 中）。",
    "",
  ];
}

function buildFieldTable(): string[] {
  return [
    "## 十四、字段对照表",
    "",
    "| json 字段 | 人话 | 常用值 |",
    "| --- | --- | --- |",
    "| `enabled` | 总开关 | `true` / `false` |",
    "| `hooks` | 哪些 Git 操作前自动审查 | `[\"pre-push\"]`、`[]` |",
    "| `reviewMode` | 审查后端 | `agent` / `provider` |",
    "| `agent` | Agent 类型 | `cursor` / `claude` |",
    "| `provider.type` | API 平台 | deepseek / minimax / codex |",
    "| `provider.model` | 模型 ID | deepseek-chat 等 |",
    "| `provider.baseUrl` | API 根地址（可选） | 留空用默认 |",
    "| `provider.path` | API 路径（可选） | 留空用默认 |",
    "| `baseline` | 分支审查对比基线 | `auto`（推荐） |",
    "| `defaultScope` | 手动审查默认范围 | branch / uncommitted / staged |",
    "| `timeoutMs` | 单次审查最长等待 | 900000（15 分钟） |",
    `| \`${API_KEY_ENV_REL}\` | hook 环境变量（Key、ALLOW_CUSTOM 等） | 扩展自动写入 |`,
    `| \`${WORKSPACE_PROMPT_REL}\` | 审查 prompt 正文 | 见文件 |`,
    "",
  ];
}

export function describeConfig(config: AiCodeReviewConfig, promptText = ""): string {
  const lines: string[] = [
    ...buildGuideIntro(),
    ...buildInstallGuide(),
    ...buildFileStructure(),
    ...buildQuickStart(),
    ...buildCommandsSection(),
    ...buildUsageScenarios(),
    ...buildHookGuide(config.hooks),
    ...buildReviewFlow(),
    ...buildAgentProviderGuide(config),
    ...buildCurrentConfig(config, promptText),
  ];

  if (config.reviewMode === "provider") {
    lines.push(...buildProviderTutorial());
  }

  lines.push(
    ...buildSkipAndEmergency(),
    ...buildEnvVars(),
    ...buildFaq(),
    ...buildFieldTable()
  );

  return lines.join("\n");
}
