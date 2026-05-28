import * as vscode from "vscode";
import { registerEnableCommand } from "./commands/enable";
import { registerDisableCommand } from "./commands/disable";
import { registerRunReviewCommand } from "./commands/runReview";
import { registerOpenReportCommand } from "./commands/openReport";
import { SettingsProvider } from "./settings/settingsProvider";
import { HookInstaller } from "./infrastructure/hookInstaller";
import { updateStatusBar } from "./infrastructure/statusBar";

export function activate(context: vscode.ExtensionContext) {
  const settingsProvider = new SettingsProvider();
  const hookInstaller = new HookInstaller(context);

  registerEnableCommand(context, settingsProvider, hookInstaller);
  registerDisableCommand(context, settingsProvider, hookInstaller);
  registerRunReviewCommand(context, settingsProvider, hookInstaller);
  registerOpenReportCommand(context);

  updateStatusBar(settingsProvider, hookInstaller);

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (!e.affectsConfiguration("cursorPrePush")) return;
      if (hookInstaller.isHookInstalled()) {
        hookInstaller.syncWorkspaceConfig(settingsProvider);
      }
      updateStatusBar(settingsProvider, hookInstaller);
    })
  );
}

export function deactivate() {}
