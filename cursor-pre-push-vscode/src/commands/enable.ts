import * as vscode from "vscode";
import { SettingsProvider } from "../settings/settingsProvider";
import { HookInstaller } from "../infrastructure/hookInstaller";
import { updateStatusBar } from "../infrastructure/statusBar";

export function registerEnableCommand(
  context: vscode.ExtensionContext,
  settingsProvider: SettingsProvider,
  hookInstaller: HookInstaller
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("cursor.prePush.enable", async () => {
      const success = await hookInstaller.install(settingsProvider);
      if (success) {
        await settingsProvider.setEnabled(true);
        updateStatusBar(settingsProvider, hookInstaller);
        vscode.window.showInformationMessage("已启用 Pre-push 审查");
      }
    })
  );
}
