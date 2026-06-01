import * as vscode from "vscode";
import { ensureDependencies, notifyDependencyIssues } from "../infrastructure/dependencyInstaller";

export function registerInstallDepsCommand(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("cursor.prePush.installDeps", async () => {
      const status = await ensureDependencies(context, { force: true });
      if (status.reviewCli && status.agent) {
        vscode.window.showInformationMessage("依赖已就绪：扩展内置审查 CLI、Cursor Agent CLI");
      } else {
        notifyDependencyIssues(status);
      }
    })
  );
}
