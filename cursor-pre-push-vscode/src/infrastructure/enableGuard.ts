import * as vscode from "vscode";
import { SettingsProvider } from "../settings/settingsProvider";
import {
  ensureDependencies,
  notifyDependencyIssues,
} from "./dependencyInstaller";
import {
  API_KEY_ENV_REL,
  getApiKey,
  hasHookUsableApiKey,
  readDotEnvApiKey,
  syncHookEnvFile,
} from "./secrets";

/** 安装 hook 前的前置校验（enable / runReview 共用） */
export async function validateBeforeEnable(
  context: vscode.ExtensionContext,
  settingsProvider: SettingsProvider
): Promise<boolean> {
  if (settingsProvider.reviewMode === "agent") {
    const agentType = settingsProvider.agent;
    const deps = await ensureDependencies(context, { agentType });
    if (!deps.reviewCli) {
      notifyDependencyIssues(deps, { agentType });
      return false;
    }
    if (!deps.agent) {
      notifyDependencyIssues(deps, { agentType });
      return false;
    }
    return true;
  }

  const deps = await ensureDependencies(context, { skipAgent: true });
  if (!deps.reviewCli) {
    notifyDependencyIssues(deps);
    return false;
  }

  const repoRoot = settingsProvider.workspaceRoot;
  const secretKey = hasHookUsableApiKey(repoRoot)
    ? undefined
    : (await getApiKey(context)) || undefined;
  syncHookEnvFile(repoRoot, settingsProvider.providerHookEnvOptions(secretKey));

  if (settingsProvider.hooks.length === 0) return true;
  if (hasHookUsableApiKey(repoRoot)) return true;

  const choice = await vscode.window.showWarningMessage(
    `Provider 模式安装 Git hook 需要在 ${API_KEY_ENV_REL} 配置 AI_CODE_REVIEW_API_KEY`,
    "设置 API Key",
    "取消"
  );
  if (choice === "设置 API Key") {
    await vscode.commands.executeCommand("aiCodeReview.setApiKey");
    return hasHookUsableApiKey(repoRoot);
  }
  return false;
}

export async function resolveProviderApiKey(
  context: vscode.ExtensionContext,
  repoRoot: string | undefined
): Promise<string> {
  const fromSecret = await getApiKey(context);
  if (fromSecret) return fromSecret;
  return readDotEnvApiKey(repoRoot);
}
