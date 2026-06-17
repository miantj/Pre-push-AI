import * as vscode from "vscode";
import { spawn } from "child_process";
import * as fs from "fs";
import { ReviewScope, SettingsProvider } from "../settings/settingsProvider";
import { augmentedPathEnv, getBundledReviewCliPath } from "./runtimePaths";
import { resolveProviderApiKey } from "./enableGuard";
import { API_KEY_ENV_REL } from "./secrets";
import {
  appendReviewOutput,
  clearReviewOutput,
  logReviewLine,
  showReviewOutput,
} from "./reviewOutput";

export interface RunCliOptions {
  reviewOnly?: boolean;
  forceEnabled?: boolean;
  scope?: ReviewScope;
  fromHook?: boolean;
  /** 进度摘要（状态栏 / 可选 UI） */
  onProgress?: (message: string) => void;
}

function extractReviewStatusLine(line: string): string | undefined {
  const trimmed = line.trim();
  if (!trimmed) return undefined;
  const tagged = trimmed.match(/^\[ai-code-review\]\s*(.+)/);
  if (!tagged) return undefined;
  const msg = tagged[1].trim();
  if (!msg || msg.startsWith("==========")) return undefined;
  return msg.length > 100 ? `${msg.slice(0, 97)}…` : msg;
}

function feedCliOutput(
  chunk: string,
  lastStatus: { value: string },
  onProgress?: (message: string) => void
): void {
  appendReviewOutput(chunk);
  if (!onProgress) return;
  for (const line of chunk.split(/\r?\n/)) {
    const status = extractReviewStatusLine(line);
    if (!status || status === lastStatus.value) continue;
    lastStatus.value = status;
    onProgress(status);
  }
}

function formatElapsed(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (mins > 0) return `${mins}分${secs.toString().padStart(2, "0")}秒`;
  return `${secs}秒`;
}

export async function runCliReview(
  settingsProvider: SettingsProvider,
  extensionPath: string,
  context: vscode.ExtensionContext,
  options: RunCliOptions = {}
): Promise<boolean> {
  const cliPath = getBundledReviewCliPath(extensionPath);

  if (!fs.existsSync(cliPath)) {
    vscode.window.showErrorMessage(`未找到 CLI: ${cliPath}`);
    return false;
  }

  const cwd = settingsProvider.workspaceRoot;
  if (!cwd) {
    vscode.window.showErrorMessage("未打开工作区文件夹，无法执行审查");
    return false;
  }

  const runEnabled = options.forceEnabled ?? settingsProvider.enabled;

  const cmd = options.reviewOnly ? "review" : "run";
  const scope = options.scope ?? settingsProvider.defaultScope;

  let apiKey = "";
  if (settingsProvider.reviewMode === "provider") {
    apiKey = await resolveProviderApiKey(context, cwd);
    if (!apiKey) {
      const choice = await vscode.window.showWarningMessage(
        `Provider 模式需要 API Key（SecretStorage 或 ${API_KEY_ENV_REL}），是否现在设置？`,
        "设置 API Key",
        "取消"
      );
      if (choice === "设置 API Key") {
        await vscode.commands.executeCommand("aiCodeReview.setApiKey");
      }
      return false;
    }
  }

  const args = [cliPath, cmd, "--scope", scope];

  if (options.reviewOnly) {
    showReviewOutput();
    clearReviewOutput();
    logReviewLine(`── 开始审查（scope=${scope} · ${settingsProvider.reviewMode}）──`);
  }

  return new Promise((resolve) => {
    const env: NodeJS.ProcessEnv = {
      ...augmentedPathEnv(),
      ELECTRON_RUN_AS_NODE: "1",
      AI_CODE_REVIEW_ENABLED: runEnabled ? "true" : "false",
      AI_CODE_REVIEW_MODE: settingsProvider.reviewMode,
      AI_CODE_REVIEW_AGENT: settingsProvider.agent,
      AI_CODE_REVIEW_PROVIDER: settingsProvider.providerType,
      AI_CODE_REVIEW_PROVIDER_MODEL: settingsProvider.providerModel,
      AI_CODE_REVIEW_PROVIDER_BASE_URL: settingsProvider.providerBaseUrl,
      AI_CODE_REVIEW_PROVIDER_PATH: settingsProvider.providerPath,
      AI_CODE_REVIEW_SCOPE: scope,
      AI_CODE_REVIEW_BASELINE: settingsProvider.baseline,
      AI_CODE_REVIEW_TIMEOUT_MS: String(settingsProvider.timeoutMs),
      AI_CODE_REVIEW_FROM_HOOK: options.fromHook ? "1" : "0",
    };
    if (apiKey) {
      env.AI_CODE_REVIEW_API_KEY = apiKey;
    }
    if (settingsProvider.providerAllowCustomUrl) {
      env.AI_CODE_REVIEW_ALLOW_CUSTOM_PROVIDER_URL = "1";
    }

    const proc = spawn(process.execPath, args, { cwd, env });
    const lastStatus = { value: "" };
    const startedAt = Date.now();
    let heartbeatTimer: ReturnType<typeof setInterval> | undefined;

    const pushHeartbeat = () => {
      const elapsedSec = Math.floor((Date.now() - startedAt) / 1000);
      const base = lastStatus.value || "Agent 审查中";
      const msg = `${base} · 已 ${formatElapsed(elapsedSec)}`;
      if (options.onProgress) options.onProgress(msg);
      if (options.reviewOnly) {
        logReviewLine(`[${new Date().toLocaleTimeString("zh-CN")}] ${msg}`);
      }
    };

    const stopHeartbeat = () => {
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = undefined;
      }
    };

    options.onProgress?.("正在启动审查 CLI…");
    heartbeatTimer = setInterval(pushHeartbeat, 3000);

    let output = "";
    proc.stdout?.on("data", (data) => {
      const text = data.toString();
      output += text;
      feedCliOutput(text, lastStatus, options.onProgress);
    });
    proc.stderr?.on("data", (data) => {
      const text = data.toString();
      output += text;
      feedCliOutput(text, lastStatus, options.onProgress);
    });

    const finish = (ok: boolean) => {
      stopHeartbeat();
      resolve(ok);
    };

    proc.on("close", (code) => {
      const verdictFail = /AI_CODE_REVIEW_VERDICT:\s*FAIL\b/m.test(output);
      const manualFailure =
        /\[ai-code-review\].*(不阻断 git 操作|审查依赖缺失|hook runner 不可用)/m.test(output);
      if (code !== 0 || manualFailure) {
        vscode.window.showErrorMessage(
          code !== 0
            ? `审查未通过（exit ${code}），请查看输出面板或 .cursor/ai-code-review-last.md`
            : "审查未通过或异常，请查看输出面板或 .cursor/ai-code-review-last.md"
        );
        if (output.trim()) appendReviewOutput(`\n--- exit ${code ?? "?"} ---\n`);
        finish(false);
        return;
      }
      if (verdictFail) {
        vscode.window.showWarningMessage(
          "审查结论：FAIL（未阻断 git 操作），请查看报告了解详情"
        );
        if (options.reviewOnly) logReviewLine("── 审查完成：FAIL ──");
        finish(false);
        return;
      }
      if (options.reviewOnly) logReviewLine("── 审查完成：PASS ──");
      finish(true);
    });

    proc.on("error", (err) => {
      stopHeartbeat();
      vscode.window.showErrorMessage(`CLI 执行失败: ${err.message}`);
      resolve(false);
    });
  });
}
