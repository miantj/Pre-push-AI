import * as fs from "fs";
import * as path from "path";
import { resolveEffectiveBaseline } from "./git";

export interface PrePushReviewConfig {
  enabled: boolean;
  baseline: string;
  agent: "cursor" | "claude";
  timeoutMs: number;
}

export const CONFIG_REL_PATH = ".cursor/pre-push-review.json";

const DEFAULTS: PrePushReviewConfig = {
  enabled: false,
  baseline: "auto",
  agent: "cursor",
  timeoutMs: 900000,
};

export function configFilePath(repoRoot: string): string {
  return path.join(repoRoot, CONFIG_REL_PATH);
}

export function loadConfigFile(repoRoot: string): PrePushReviewConfig | null {
  const filePath = configFilePath(repoRoot);
  if (!fs.existsSync(filePath)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, "utf8")) as Partial<PrePushReviewConfig>;
    return { ...DEFAULTS, ...raw };
  } catch (e) {
    console.error(`[cursor-pre-push] 无法解析 ${filePath}，将使用默认配置:`, e);
    return { ...DEFAULTS };
  }
}

export function writeConfigFile(repoRoot: string, config: PrePushReviewConfig): void {
  const filePath = configFilePath(repoRoot);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

/**
 * 环境变量优先于配置文件。
 */
export function resolveRuntimeConfig(repoRoot: string): PrePushReviewConfig {
  const fromFile = loadConfigFile(repoRoot) ?? { ...DEFAULTS };
  const agentRaw = process.env.AI_REVIEW_AGENT ?? fromFile.agent;
  const agent =
    String(agentRaw).toLowerCase() === "claude" || String(agentRaw).toLowerCase() === "claude-code"
      ? "claude"
      : "cursor";

  let enabled = fromFile.enabled;
  const hookFlag = process.env.USE_AI_REVIEW_ON_PRE_PUSH_HOOK;
  if (hookFlag != null && String(hookFlag).trim() !== "") {
    const v = String(hookFlag).trim().toLowerCase();
    if (["true", "1", "yes", "on"].includes(v)) enabled = true;
    if (["false", "0", "no", "off"].includes(v)) enabled = false;
  }

  const baselineInput =
    process.env.CURSOR_PRE_PUSH_BASELINE?.trim() || fromFile.baseline;
  const { baseline: resolvedBaseline } = resolveEffectiveBaseline(repoRoot, baselineInput);

  return {
    enabled,
    baseline: resolvedBaseline ?? baselineInput,
    agent,
    timeoutMs: Number(process.env.CURSOR_PRE_PUSH_TIMEOUT_MS) || fromFile.timeoutMs,
  };
}

export function shouldRunReview(config: PrePushReviewConfig): boolean {
  return config.enabled;
}
