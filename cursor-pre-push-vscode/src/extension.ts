import * as vscode from "vscode";
import { registerEnableCommand } from "./commands/enable";
import { registerDisableCommand } from "./commands/disable";
import { registerRunReviewCommand } from "./commands/runReview";
import { registerOpenReportCommand } from "./commands/openReport";
import { registerInstallDepsCommand } from "./commands/installDeps";
import { SettingsProvider } from "./settings/settingsProvider";
import { HookInstaller } from "./infrastructure/hookInstaller";
import { updateStatusBar } from "./infrastructure/statusBar";
import {
  ensureDependencies,
  notifyDependencyIssues,
} from "./infrastructure/dependencyInstaller";

export function activate(context: vscode.ExtensionContext) {
  const settingsProvider = new SettingsProvider();
  const hookInstaller = new HookInstaller(context);

  registerEnableCommand(context, settingsProvider, hookInstaller);
  registerDisableCommand(context, settingsProvider, hookInstaller);
  registerRunReviewCommand(context, settingsProvider, hookInstaller);
  registerOpenReportCommand(context);
  registerInstallDepsCommand(context);

  void ensureDependencies(context, { silent: true }).then((status) => {
    if (!status.reviewCli) {
      notifyDependencyIssues(status);
      return;
    }
    if (!status.agent) {
      notifyDependencyIssues(status);
    }
  });

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
