import * as vscode from "vscode";
import { SettingsProvider } from "../settings/settingsProvider";
import { HookInstaller } from "../infrastructure/hookInstaller";
import { removeDotEnvApiKey } from "../infrastructure/secrets";
import { updateStatusBar } from "../infrastructure/statusBar";

export function registerDisableCommand(
  context: vscode.ExtensionContext,
  settingsProvider: SettingsProvider,
  hookInstaller: HookInstaller
): void {
  const handler = async () => {
    const success = await hookInstaller.uninstall(settingsProvider);
    if (success) {
      await settingsProvider.setEnabled(false);
      const root = settingsProvider.workspaceRoot;
      if (root) removeDotEnvApiKey(root);
      updateStatusBar(settingsProvider, hookInstaller);
      vscode.window.showInformationMessage("已禁用 AI Code Review");
    }
  };
  context.subscriptions.push(
    vscode.commands.registerCommand("aiCodeReview.disable", handler)
  );
}
