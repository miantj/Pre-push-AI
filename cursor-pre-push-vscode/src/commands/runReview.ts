import * as vscode from "vscode";
import { SettingsProvider } from "../settings/settingsProvider";
import { HookInstaller } from "../infrastructure/hookInstaller";
import { runCliReview } from "../infrastructure/cliRunner";

export function registerRunReviewCommand(
  context: vscode.ExtensionContext,
  settingsProvider: SettingsProvider,
  hookInstaller: HookInstaller
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("cursor.prePush.runReview", async () => {
      let forceEnabled = settingsProvider.enabled;
      if (!forceEnabled) {
        const choice = await vscode.window.showWarningMessage(
          "Pre-push 审查未启用，是否立即启用？",
          "启用并审查",
          "仅本次审查",
          "取消"
        );
        if (choice === "取消" || !choice) return;
        if (choice === "启用并审查") {
          const ok = await hookInstaller.install(settingsProvider);
          if (!ok) return;
          await settingsProvider.setEnabled(true);
          forceEnabled = true;
        } else {
          forceEnabled = true;
        }
      }

      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: "正在执行 Pre-push 审查（不 rebase）...",
          cancellable: false,
        },
        async () => {
          const result = await runCliReview(settingsProvider, context.extensionPath, {
            reviewOnly: true,
            forceEnabled,
          });
          if (result) {
            vscode.commands.executeCommand("cursor.prePush.openReport");
          }
        }
      );
    })
  );
}
