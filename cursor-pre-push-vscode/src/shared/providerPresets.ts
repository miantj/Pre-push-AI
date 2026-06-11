export type ProviderType = "deepseek" | "minimax" | "codex";

/** 各平台默认值；用户 json 里只需配正在用的那一套 */
export const PROVIDER_PRESETS: Record<
  ProviderType,
  { baseUrl: string; defaultModel: string; path: string }
> = {
  deepseek: {
    baseUrl: "https://api.deepseek.com",
    defaultModel: "deepseek-chat",
    path: "/v1/chat/completions",
  },
  minimax: {
    baseUrl: "https://api.minimax.io",
    defaultModel: "MiniMax-M3",
    path: "/v1/text/chatcompletion_v2",
  },
  codex: {
    baseUrl: "https://api.openai.com",
    defaultModel: "gpt-4o",
    path: "/v1/chat/completions",
  },
};
