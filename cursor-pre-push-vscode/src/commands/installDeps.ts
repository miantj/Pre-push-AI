import * as vscode from "vscode";
import {
  ensureDependencies,
  notifyDependencyIssues,
} from "../infrastructure/dependencyInstaller";
import { SettingsProvider } from "../settings/settingsProvider";

export function registerInstallDepsCommand(
  context: vscode.ExtensionContext,
  settingsProvider: SettingsProvider
): void {
  const handler = async () => {
    const reviewMode = settingsProvider.reviewMode;
    const agentType = settingsProvider.agent;
    const status = await ensureDependencies(context, {
      force: true,
      skipAgent: reviewMode === "provider",
      agentType,
    });
    if (status.reviewCli && status.agent) {
      const agentLabel =
        reviewMode === "provider"
          ? "Provider 模式（无需 Agent CLI）"
          : agentType === "claude"
            ? "Claude Code CLI"
            : "Cursor Agent CLI";
      vscode.window.showInformationMessage(`依赖已就绪：扩展内置审查 CLI、${agentLabel}`);
    } else {
      notifyDependencyIssues(status, { agentType });
    }
  };
  context.subscriptions.push(
    vscode.commands.registerCommand("aiCodeReview.installDeps", handler)
  );
}
