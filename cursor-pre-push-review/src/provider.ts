import { ProviderConfig, ProviderType } from "./types";

export interface ProviderPreset {
  baseUrl: string;
  defaultModel: string;
  path: string;
}

export const PROVIDER_PRESETS: Record<ProviderType, ProviderPreset> = {
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

export interface ProviderRunResult {
  combined: string;
  ok: boolean;
  reason?: string;
}

const PROVIDER_ALLOWED_HOSTS: Record<ProviderType, readonly string[]> = {
  deepseek: ["api.deepseek.com"],
  minimax: ["api.minimax.io", "api.minimaxi.com"],
  codex: ["api.openai.com"],
};

function isAllowedProviderHost(type: ProviderType, hostname: string): boolean {
  if (PROVIDER_ALLOWED_HOSTS[type].includes(hostname)) return true;
  return process.env.AI_CODE_REVIEW_ALLOW_CUSTOM_PROVIDER_URL === "1";
}

/** 校验并规范化 Provider baseUrl；非法自定义 URL 返回 undefined（回退 preset） */
export function sanitizeProviderBaseUrl(
  type: ProviderType,
  raw?: string
): string | undefined {
  const custom = raw?.trim();
  if (!custom) return undefined;

  let parsed: URL;
  try {
    parsed = new URL(custom);
  } catch {
    console.warn(`[ai-code-review] 忽略非法 provider.baseUrl: ${custom}`);
    return undefined;
  }

  if (parsed.protocol !== "https:") {
    console.warn("[ai-code-review] provider.baseUrl 必须使用 https，已忽略自定义值");
    return undefined;
  }

  if (!isAllowedProviderHost(type, parsed.hostname)) {
    console.warn(
      `[ai-code-review] 自定义 provider.baseUrl 未在白名单（需 AI_CODE_REVIEW_ALLOW_CUSTOM_PROVIDER_URL=1）`
    );
    return undefined;
  }

  return custom.replace(/\/$/, "");
}

function normalizeProviderPath(raw: string | undefined, fallback: string): string {
  const p = raw?.trim() || fallback;
  return p.startsWith("/") ? p : `/${p}`;
}

function resolveProviderEndpoint(config: ProviderConfig): { url: string; model: string } {
  const preset = PROVIDER_PRESETS[config.type];
  const baseUrl = sanitizeProviderBaseUrl(config.type, config.baseUrl) || preset.baseUrl;
  const model = config.model?.trim() || preset.defaultModel;
  const apiPath = normalizeProviderPath(config.path, preset.path);
  return { url: `${baseUrl.replace(/\/$/, "")}${apiPath}`, model };
}

export async function runReviewProvider(
  prompt: string,
  config: ProviderConfig,
  timeoutMs: number
): Promise<ProviderRunResult> {
  const apiKey = process.env.AI_CODE_REVIEW_API_KEY?.trim();
  if (!apiKey) {
    return { combined: "", ok: false, reason: "missing API key (AI_CODE_REVIEW_API_KEY)" };
  }

  const endpoint = resolveProviderEndpoint(config);
  const { url, model } = endpoint;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.2,
      }),
      signal: controller.signal,
    });

    const raw = await res.text();
    if (!res.ok) {
      return {
        combined: raw,
        ok: false,
        reason: `provider HTTP ${res.status}`,
      };
    }

    let content = raw;
    try {
      const json = JSON.parse(raw) as {
        choices?: Array<{ message?: { content?: string } }>;
        output?: { text?: string };
        reply?: string;
      };
      content =
        json.choices?.[0]?.message?.content ??
        json.output?.text ??
        json.reply ??
        raw;
    } catch {
      // keep raw text
    }

    return { combined: String(content).trim(), ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const reason = msg.includes("abort") ? `timeout (${timeoutMs}ms)` : msg;
    return { combined: "", ok: false, reason };
  } finally {
    clearTimeout(timer);
  }
}
