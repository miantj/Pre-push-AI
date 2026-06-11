export type ReviewScope = "branch" | "uncommitted" | "staged";

export type ReviewBackendMode = "agent" | "provider";

export type AgentType = "cursor" | "claude";

export type ProviderType = "deepseek" | "minimax" | "codex";

export type HookType = "pre-push" | "pre-commit" | "commit-msg" | "post-merge";

export interface ProviderConfig {
  type: ProviderType;
  model: string;
  baseUrl?: string;
  /** API 路径，与 baseUrl 拼接；留空则用 type 对应默认 */
  path?: string;
}

export interface AiCodeReviewConfig {
  enabled: boolean;
  hooks: HookType[];
  reviewMode: ReviewBackendMode;
  agent: AgentType;
  provider: ProviderConfig;
  baseline: string;
  defaultScope: ReviewScope;
  timeoutMs: number;
}

export interface ReviewResult {
  ok: boolean;
  skipped?: boolean;
  reason?: string;
  cacheable?: boolean;
}
