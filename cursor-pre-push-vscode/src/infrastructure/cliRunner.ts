import * as vscode from "vscode";
import { spawn } from "child_process";
import * as fs from "fs";
import { ReviewScope, SettingsProvider } from "../settings/settingsProvider";
import { augmentedPathEnv, getBundledReviewCliPath } from "./runtimePaths";
import { resolveProviderApiKey } from "./enableGuard";
import { API_KEY_ENV_REL } from "./secrets";

export interface RunCliOptions {
  reviewOnly?: boolean;
  forceEnabled?: boolean;
  scope?: ReviewScope;
  fromHook?: boolean;
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

    const proc = spawn(process.execPath, args, { cwd, env });

    let output = "";
    proc.stdout?.on("data", (data) => {
      output += data.toString();
    });
    proc.stderr?.on("data", (data) => {
      output += data.toString();
    });

    proc.on("close", (code) => {
      const verdictFail = /AI_CODE_REVIEW_VERDICT:\s*FAIL\b/m.test(output);
      if (code !== 0) {
        vscode.window.showErrorMessage(
          `审查未通过（exit ${code}），请查看 .cursor/ai-code-review-last.md`
        );
        if (output.trim()) console.error(output);
        resolve(false);
        return;
      }
      if (verdictFail) {
        vscode.window.showWarningMessage(
          "审查结论：FAIL（未阻断 git 操作），请查看报告了解详情"
        );
        resolve(false);
        return;
      }
      if (output.trim()) {
        const firstLine = output.trim().split("\n")[0];
        vscode.window.showInformationMessage(firstLine.substring(0, 120));
      }
      resolve(true);
    });

    proc.on("error", (err) => {
      vscode.window.showErrorMessage(`CLI 执行失败: ${err.message}`);
      resolve(false);
    });
  });
}
