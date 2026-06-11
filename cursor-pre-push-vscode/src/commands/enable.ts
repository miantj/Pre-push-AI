import * as vscode from "vscode";
import { SettingsProvider } from "../settings/settingsProvider";
import { HookInstaller } from "../infrastructure/hookInstaller";
import { updateStatusBar } from "../infrastructure/statusBar";
import { validateBeforeEnable } from "../infrastructure/enableGuard";

async function enableReview(
  context: vscode.ExtensionContext,
  settingsProvider: SettingsProvider,
  hookInstaller: HookInstaller
): Promise<void> {
  if (!(await validateBeforeEnable(context, settingsProvider))) return;

  const success = await hookInstaller.install(settingsProvider);
  if (success) {
    updateStatusBar(settingsProvider, hookInstaller);
  }
}

export function registerEnableCommand(
  context: vscode.ExtensionContext,
  settingsProvider: SettingsProvider,
  hookInstaller: HookInstaller
): void {
  const handler = () => enableReview(context, settingsProvider, hookInstaller);
  context.subscriptions.push(
    vscode.commands.registerCommand("aiCodeReview.enable", handler)
  );
}
