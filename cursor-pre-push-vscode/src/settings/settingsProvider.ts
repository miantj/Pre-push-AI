import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { PROVIDER_PRESETS } from "../shared/providerPresets";
import { describeConfig } from "../shared/configLabels";
import { ensureGitignoreEntries } from "../infrastructure/gitignoreUpdater";
import { readWorkspaceReviewPrompt } from "../infrastructure/reviewPromptFile";
import {
  API_KEY_ENV_REL,
  WORKSPACE_CONFIG_GUIDE_REL,
  WORKSPACE_CONFIG_REL,
} from "../shared/workspacePaths";

export {
  API_KEY_ENV_REL,
  WORKSPACE_CONFIG_GUIDE_REL,
  WORKSPACE_CONFIG_REL,
} from "../shared/workspacePaths";

export type ReviewScope = "branch" | "uncommitted" | "staged";
export type ReviewBackendMode = "agent" | "provider";
export type AgentType = "cursor" | "claude";
export type ProviderType = "deepseek" | "minimax" | "codex";
export type HookType = "pre-push" | "pre-commit" | "commit-msg" | "post-merge";

export interface AiCodeReviewConfig {
  enabled: boolean;
  hooks: HookType[];
  reviewMode: ReviewBackendMode;
  agent: AgentType;
  provider: { type: ProviderType; model: string; baseUrl?: string; path?: string };
  baseline: string;
  defaultScope: ReviewScope;
  timeoutMs: number;
}

const CONFIG_SECTION = "aiCodeReview";
const VALID_HOOKS = new Set<string>(["pre-push", "pre-commit", "commit-msg", "post-merge"]);

const DEFAULTS: AiCodeReviewConfig = {
  enabled: false,
  hooks: ["pre-push"],
  reviewMode: "agent",
  agent: "cursor",
  provider: {
    type: "deepseek",
    model: PROVIDER_PRESETS.deepseek.defaultModel,
  },
  baseline: "auto",
  defaultScope: "branch",
  timeoutMs: 900000,
};

function getVscodeSetting<T>(key: string, fallback: T): T {
  return vscode.workspace.getConfiguration(CONFIG_SECTION).get<T>(key) ?? fallback;
}

function normalizeEnabled(raw: unknown, fallback: boolean): boolean {
  if (raw === true || raw === "true") return true;
  if (raw === false || raw === "false" || raw === 0 || raw === "0") return false;
  if (raw === undefined) return fallback;
  return fallback;
}

function normalizeScope(raw: unknown): ReviewScope {
  const v = String(raw ?? "branch").toLowerCase();
  if (v === "uncommitted") return "uncommitted";
  if (v === "staged") return "staged";
  return "branch";
}

function mergeConfig(raw: Partial<AiCodeReviewConfig>): AiCodeReviewConfig {
  const providerType =
    raw.provider?.type === "minimax" || raw.provider?.type === "codex"
      ? raw.provider.type
      : "deepseek";
  const preset = PROVIDER_PRESETS[providerType];
  const hooksRaw = raw.hooks;
  let hooks: HookType[] = ["pre-push"];
  if (hooksRaw !== undefined) {
    if (hooksRaw.length === 0) hooks = [];
    else {
      const picked = hooksRaw.filter((h): h is HookType => VALID_HOOKS.has(h));
      hooks = picked.length ? picked : ["pre-push"];
    }
  }
  return {
    ...DEFAULTS,
    ...raw,
    enabled: normalizeEnabled(raw.enabled, DEFAULTS.enabled),
    hooks,
    reviewMode: raw.reviewMode === "provider" ? "provider" : "agent",
    agent: raw.agent === "claude" ? "claude" : "cursor",
    provider: {
      type: providerType,
      model: raw.provider?.model?.trim() || preset.defaultModel,
      baseUrl: raw.provider?.baseUrl?.trim() || undefined,
      path: raw.provider?.path?.trim() || undefined,
    },
    defaultScope: normalizeScope(raw.defaultScope),
    timeoutMs:
      Number.isFinite(Number(raw.timeoutMs)) && Number(raw.timeoutMs) > 0
        ? Math.floor(Number(raw.timeoutMs))
        : DEFAULTS.timeoutMs,
  };
}

/** 首次启用前：用 Cursor 设置面板里的默认值拼出初始配置 */
function configFromVscodeSettings(): AiCodeReviewConfig {
  const providerTypeRaw = getVscodeSetting<string>("providerType", "deepseek");
  const providerType: ProviderType =
    providerTypeRaw === "minimax" || providerTypeRaw === "codex" ? providerTypeRaw : "deepseek";
  const preset = PROVIDER_PRESETS[providerType];
  const hooks = getVscodeSetting<string[]>("hooks", ["pre-push"]);
  return mergeConfig({
    enabled: getVscodeSetting<boolean>("enabled", false),
    hooks: hooks as HookType[],
    reviewMode: getVscodeSetting<string>("reviewMode", "agent") === "provider" ? "provider" : "agent",
    agent: getVscodeSetting<string>("agent", "cursor") === "claude" ? "claude" : "cursor",
    provider: {
      type: providerType,
      model: getVscodeSetting<string>("providerModel", preset.defaultModel),
      baseUrl: getVscodeSetting<string>("providerBaseUrl", "").trim() || undefined,
    },
    baseline: getVscodeSetting<string>("baseline", "auto"),
    defaultScope:
      getVscodeSetting<string>("defaultScope", "branch") === "uncommitted"
        ? "uncommitted"
        : getVscodeSetting<string>("defaultScope", "branch") === "staged"
          ? "staged"
          : "branch",
    timeoutMs: getVscodeSetting<number>("timeoutMs", 900000),
  });
}

export class SettingsProvider {
  private configRoot: vscode.WorkspaceFolder | undefined;
  private cachedFileConfig: AiCodeReviewConfig | null | undefined;
  private configParseError: string | null = null;

  constructor() {
    this.configRoot = vscode.workspace.workspaceFolders?.[0];
  }

  /** 配置文件变更后调用，使下次读取重新加载 json */
  invalidateCache(): void {
    this.cachedFileConfig = undefined;
    this.configParseError = null;
  }

  private readFileConfig(): AiCodeReviewConfig | null {
    if (this.cachedFileConfig !== undefined) {
      return this.cachedFileConfig;
    }
    const root = this.workspaceRoot;
    if (!root) {
      this.cachedFileConfig = null;
      return null;
    }
    const filePath = path.join(root, WORKSPACE_CONFIG_REL);
    if (!fs.existsSync(filePath)) {
      this.cachedFileConfig = null;
      return null;
    }
    try {
      const raw = JSON.parse(fs.readFileSync(filePath, "utf8")) as Partial<AiCodeReviewConfig>;
      this.cachedFileConfig = mergeConfig(raw);
      this.configParseError = null;
      return this.cachedFileConfig;
    } catch (e) {
      this.configParseError = e instanceof Error ? e.message : String(e);
      this.cachedFileConfig = null;
      vscode.window.showErrorMessage(
        `AI Code Review 配置文件解析失败，请修复 ${WORKSPACE_CONFIG_REL} 后重试。`
      );
      return null;
    }
  }

  /**
   * 工作区配置唯一来源：`.cursor/ai-code-review/config.json`（存在时）。
   * 不存在时回退 Cursor 设置默认值（用于首次「启用审查」）。
   */
  getEffectiveConfig(): AiCodeReviewConfig {
    const fileConfig = this.readFileConfig();
    if (this.configParseError) {
      return {
        ...configFromVscodeSettings(),
        enabled: false,
        hooks: [],
      };
    }
    return fileConfig ?? configFromVscodeSettings();
  }

  get hasConfigParseError(): boolean {
    this.readFileConfig();
    return this.configParseError !== null;
  }

  get hasWorkspaceConfigFile(): boolean {
    return this.readFileConfig() !== null;
  }

  /** 磁盘上是否存在 config.json（不论是否解析成功） */
  get workspaceConfigExists(): boolean {
    const root = this.workspaceRoot;
    if (!root) return false;
    return fs.existsSync(path.join(root, WORKSPACE_CONFIG_REL));
  }

  get enabled(): boolean {
    return this.getEffectiveConfig().enabled;
  }

  get hooks(): HookType[] {
    return this.getEffectiveConfig().hooks;
  }

  get reviewMode(): ReviewBackendMode {
    return this.getEffectiveConfig().reviewMode;
  }

  get agent(): AgentType {
    return this.getEffectiveConfig().agent;
  }

  get providerType(): ProviderType {
    return this.getEffectiveConfig().provider.type;
  }

  get providerModel(): string {
    return this.getEffectiveConfig().provider.model;
  }

  get providerBaseUrl(): string {
    return this.getEffectiveConfig().provider.baseUrl ?? "";
  }

  get providerPath(): string {
    return this.getEffectiveConfig().provider.path ?? "";
  }

  get baseline(): string {
    return this.getEffectiveConfig().baseline;
  }

  get defaultScope(): ReviewScope {
    return this.getEffectiveConfig().defaultScope;
  }

  get reviewPrompt(): string {
    const root = this.workspaceRoot;
    return root ? readWorkspaceReviewPrompt(root) : "";
  }

  get timeoutMs(): number {
    return this.getEffectiveConfig().timeoutMs;
  }

  get autoInstallDependencies(): boolean {
    return getVscodeSetting<boolean>("autoInstallDependencies", true);
  }

  get workspaceRoot(): string | undefined {
    return this.configRoot?.uri.fsPath;
  }

  get workspaceConfigPath(): string | null {
    if (!this.configRoot) return null;
    return path.join(this.configRoot.uri.fsPath, WORKSPACE_CONFIG_REL);
  }

  toConfig(enabledOverride?: boolean): AiCodeReviewConfig {
    const base = this.getEffectiveConfig();
    if (enabledOverride === undefined) return { ...base };
    return { ...base, enabled: enabledOverride };
  }

  async setEnabled(value: boolean): Promise<void> {
    const config = { ...this.getEffectiveConfig(), enabled: value };
    this.writeWorkspaceConfigFile(config);
  }

  writeWorkspaceConfigFile(config: AiCodeReviewConfig): boolean {
    const root = this.workspaceRoot;
    if (!root) return false;
    const filePath = path.join(root, WORKSPACE_CONFIG_REL);
    try {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
      ensureGitignoreEntries(root);
      this.cachedFileConfig = mergeConfig(config);
      return this.writeWorkspaceGuideOnly(config);
    } catch {
      return false;
    }
  }

  /** 仅更新说明文档，不触碰 config.json（prompt 变更时使用） */
  writeWorkspaceGuideOnly(config?: AiCodeReviewConfig): boolean {
    const root = this.workspaceRoot;
    if (!root) return false;
    const guidePath = path.join(root, WORKSPACE_CONFIG_GUIDE_REL);
    const effective = config ?? this.getEffectiveConfig();
    const promptText = readWorkspaceReviewPrompt(root);
    try {
      fs.mkdirSync(path.dirname(guidePath), { recursive: true });
      fs.writeFileSync(guidePath, describeConfig(effective, promptText), "utf8");
      return true;
    } catch {
      return false;
    }
  }
}
