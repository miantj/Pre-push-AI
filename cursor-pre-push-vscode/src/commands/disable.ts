import * as vscode from "vscode";
import { SettingsProvider } from "../settings/settingsProvider";
import { HookInstaller } from "../infrastructure/hookInstaller";
import { updateStatusBar } from "../infrastructure/statusBar";

export function registerDisableCommand(
  context: vscode.ExtensionContext,
  settingsProvider: SettingsProvider,
  hookInstaller: HookInstaller
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("cursor.prePush.disable", async () => {
      const success = await hookInstaller.uninstall(settingsProvider);
      if (success) {
        await settingsProvider.setEnabled(false);
        updateStatusBar(settingsProvider, hookInstaller);
        vscode.window.showInformationMessage("已禁用 Pre-push 审查");
      }
    })
  );
}
