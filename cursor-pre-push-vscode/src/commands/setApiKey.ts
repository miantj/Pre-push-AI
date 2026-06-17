import * as vscode from "vscode";
import {
  API_KEY_ENV_REL,
  getApiKey,
  setApiKey,
  syncHookEnvFile,
} from "../infrastructure/secrets";
import { HookInstaller } from "../infrastructure/hookInstaller";
import { updateStatusBar } from "../infrastructure/statusBar";
import { SettingsProvider } from "../settings/settingsProvider";

async function syncHooksAfterApiKeyChange(
  settingsProvider: SettingsProvider,
  hookInstaller: HookInstaller
): Promise<void> {
  const config = settingsProvider.getEffectiveConfig();
  if (config.enabled && config.hooks.length > 0) {
    await hookInstaller.syncFromConfig(settingsProvider);
  }
  updateStatusBar(settingsProvider, hookInstaller);
}

export function registerSetApiKeyCommand(
  context: vscode.ExtensionContext,
  settingsProvider: SettingsProvider,
  hookInstaller: HookInstaller
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("aiCodeReview.setApiKey", async () => {
      const current = await getApiKey(context);
      const value = await vscode.window.showInputBox({
        title: "AI Code Review Provider API Key",
        prompt:
          `输入 Provider API Key（存于 SecretStorage，并同步写入 ${API_KEY_ENV_REL} 供 Git hook 使用）`,
        password: true,
        value: current ? "********" : "",
        ignoreFocusOut: true,
      });
      if (value === undefined) return;
      if (value === "********") return;
      await setApiKey(context, value);
      const repoRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!value.trim()) {
        syncHookEnvFile(repoRoot, settingsProvider.providerHookEnvOptions(""));
        await syncHooksAfterApiKeyChange(settingsProvider, hookInstaller);
        vscode.window.showInformationMessage(
          `API Key 已清除（SecretStorage + ${API_KEY_ENV_REL}）`
        );
        return;
      }
      const wroteEnv = syncHookEnvFile(
        repoRoot,
        settingsProvider.providerHookEnvOptions(value)
      );
      if (wroteEnv === "ok") {
        await syncHooksAfterApiKeyChange(settingsProvider, hookInstaller);
        vscode.window.showInformationMessage(
          `API Key 已保存（SecretStorage + ${API_KEY_ENV_REL}，Git hook 可用）`
        );
      } else if (wroteEnv === "tracked") {
        vscode.window.showWarningMessage(
          `${API_KEY_ENV_REL} 已被 Git 跟踪，未写入密钥。请先从版本库移除该文件后再设置。`
        );
      } else {
        vscode.window.showInformationMessage(
          `API Key 已保存至 SecretStorage（手动审查可用；Git hook 需在 ${API_KEY_ENV_REL} 配置）`
        );
      }
    })
  );
}
