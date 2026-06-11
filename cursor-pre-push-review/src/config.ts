import * as fs from "fs";
import * as path from "path";
import { PROVIDER_PRESETS, sanitizeProviderBaseUrl } from "./provider";
import { ensureReviewPromptFile } from "./reviewPromptFile";
import {
  AgentType,
  AiCodeReviewConfig,
  HookType,
  ProviderType,
  ReviewBackendMode,
  ReviewScope,
} from "./types";
export const CONFIG_REL_PATH = ".cursor/ai-code-review.json";

const VALID_HOOKS = new Set<HookType>(["pre-push", "pre-commit", "commit-msg", "post-merge"]);
const VALID_PROVIDERS = new Set<ProviderType>(["deepseek", "minimax", "codex"]);

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

export function configFilePath(repoRoot: string): string {
  return path.join(repoRoot, CONFIG_REL_PATH);
}

function normalizeHooks(input?: string[]): HookType[] {
  if (input === undefined) return ["pre-push"];
  if (input.length === 0) return [];
  const picked = input.filter((h): h is HookType => VALID_HOOKS.has(h as HookType));
  return picked.length ? picked : ["pre-push"];
}

function normalizeProviderType(raw: unknown): ProviderType {
  const v = String(raw ?? "deepseek").toLowerCase();
  if (VALID_PROVIDERS.has(v as ProviderType)) return v as ProviderType;
  return "deepseek";
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

function normalizeReviewMode(raw: unknown): ReviewBackendMode {
  const v = String(raw ?? "agent").toLowerCase();
  return v === "provider" ? "provider" : "agent";
}

function normalizeAgent(raw: unknown): AgentType {
  const v = String(raw ?? "cursor").toLowerCase();
  return v === "claude" || v === "claude-code" ? "claude" : "cursor";
}

function mergeConfig(raw: Partial<AiCodeReviewConfig>): AiCodeReviewConfig {
  const providerType = normalizeProviderType(raw.provider?.type ?? DEFAULTS.provider.type);
  const preset = PROVIDER_PRESETS[providerType];
  return {
    ...DEFAULTS,
    ...raw,
    enabled: normalizeEnabled(raw.enabled, DEFAULTS.enabled),
    hooks: normalizeHooks(raw.hooks),
    reviewMode: normalizeReviewMode(raw.reviewMode),
    agent: normalizeAgent(raw.agent),
    provider: {
      type: providerType,
      model: raw.provider?.model?.trim() || preset.defaultModel,
      baseUrl: sanitizeProviderBaseUrl(providerType, raw.provider?.baseUrl?.trim()),
      path: raw.provider?.path?.trim() || undefined,
    },
    defaultScope: normalizeScope(raw.defaultScope),
    timeoutMs:
      Number.isFinite(Number(raw.timeoutMs)) && Number(raw.timeoutMs) > 0
        ? Math.floor(Number(raw.timeoutMs))
        : DEFAULTS.timeoutMs,
  };
}

export function loadConfigFile(repoRoot: string): AiCodeReviewConfig | null {
  const loaded = loadConfigFileWithStatus(repoRoot);
  if (loaded.parseError) {
    throw new Error(
      `[ai-code-review] 无法解析 ${loaded.filePath}，请修复配置文件后重试: ${loaded.parseError}`
    );
  }
  return loaded.config;
}

export interface ConfigLoadStatus {
  config: AiCodeReviewConfig | null;
  parseError: string | null;
  filePath: string;
}

export function loadConfigFileWithStatus(repoRoot: string): ConfigLoadStatus {
  const filePath = configFilePath(repoRoot);
  if (!fs.existsSync(filePath)) {
    return { config: null, parseError: null, filePath };
  }
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, "utf8")) as Partial<AiCodeReviewConfig>;
    return { config: mergeConfig(raw), parseError: null, filePath };
  } catch (e) {
    return {
      config: null,
      parseError: e instanceof Error ? e.message : String(e),
      filePath,
    };
  }
}

export function resolveRuntimeConfig(repoRoot: string): ResolvedRuntimeConfig {
  const loaded = loadConfigFileWithStatus(repoRoot);
  if (loaded.parseError) {
    throw new Error(
      `[ai-code-review] 无法解析 ${loaded.filePath}，请修复配置文件后重试: ${loaded.parseError}`
    );
  }
  const fromFile = loaded.config ?? mergeConfig({});

  let enabled = fromFile.enabled;
  const hookFlag = process.env.AI_CODE_REVIEW_ENABLED;
  if (hookFlag != null && String(hookFlag).trim() !== "") {
    const v = String(hookFlag).trim().toLowerCase();
    if (["true", "1", "yes", "on"].includes(v)) enabled = true;
    if (["false", "0", "no", "off"].includes(v)) enabled = false;
  }

  const reviewMode = normalizeReviewMode(process.env.AI_CODE_REVIEW_MODE ?? fromFile.reviewMode);

  const agent = normalizeAgent(process.env.AI_CODE_REVIEW_AGENT ?? fromFile.agent);

  const providerType = normalizeProviderType(
    process.env.AI_CODE_REVIEW_PROVIDER ?? fromFile.provider.type
  );
  const preset = PROVIDER_PRESETS[providerType];

  const baselineInput =
    process.env.AI_CODE_REVIEW_BASELINE?.trim() || fromFile.baseline;

  const scope = normalizeScope(process.env.AI_CODE_REVIEW_SCOPE ?? fromFile.defaultScope);

  const blockOnFail = process.env.AI_CODE_REVIEW_FROM_HOOK === "1";

  return {
    ...fromFile,
    enabled,
    reviewMode,
    agent,
    provider: {
      type: providerType,
      model:
        process.env.AI_CODE_REVIEW_PROVIDER_MODEL?.trim() ||
        fromFile.provider.model ||
        preset.defaultModel,
      baseUrl: sanitizeProviderBaseUrl(
        providerType,
        process.env.AI_CODE_REVIEW_PROVIDER_BASE_URL?.trim() || fromFile.provider.baseUrl
      ),
      path: process.env.AI_CODE_REVIEW_PROVIDER_PATH?.trim() || fromFile.provider.path,
    },
    baseline: baselineInput,
    defaultScope: scope,
    scope,
    timeoutMs:
      Number(process.env.AI_CODE_REVIEW_TIMEOUT_MS) || fromFile.timeoutMs,
    reviewPrompt: ensureReviewPromptFile(repoRoot),
    blockOnFail,
  };
}

export interface ResolvedRuntimeConfig extends AiCodeReviewConfig {
  scope: ReviewScope;
  blockOnFail: boolean;
  /** 从 `.cursor/ai-code-review-prompt.md` 加载 */
  reviewPrompt: string;
}

export function shouldRunReview(config: ResolvedRuntimeConfig): boolean {
  return config.enabled;
}
