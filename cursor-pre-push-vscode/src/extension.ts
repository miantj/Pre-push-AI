import * as vscode from "vscode";
import { registerEnableCommand } from "./commands/enable";
import { registerDisableCommand } from "./commands/disable";
import { registerRunReviewCommand } from "./commands/runReview";
import { registerOpenReportCommand } from "./commands/openReport";
import { registerInstallDepsCommand } from "./commands/installDeps";
import { registerSetApiKeyCommand } from "./commands/setApiKey";
import { registerReviewPromptCommands } from "./commands/reviewPrompt";
import {
  SettingsProvider,
  WORKSPACE_CONFIG_REL,
} from "./settings/settingsProvider";
import { WORKSPACE_PROMPT_REL } from "./infrastructure/reviewPromptFile";
import { HookInstaller } from "./infrastructure/hookInstaller";
import { updateStatusBar } from "./infrastructure/statusBar";
import {
  ensureDependencies,
  notifyDependencyIssues,
} from "./infrastructure/dependencyInstaller";
import { getReviewOutputChannel } from "./infrastructure/reviewOutput";

export function activate(context: vscode.ExtensionContext) {
  const settingsProvider = new SettingsProvider();
  const hookInstaller = new HookInstaller(context);

  registerEnableCommand(context, settingsProvider, hookInstaller);
  registerDisableCommand(context, settingsProvider, hookInstaller);
  registerRunReviewCommand(context, settingsProvider, hookInstaller);
  registerOpenReportCommand(context);
  registerInstallDepsCommand(context, settingsProvider);
  registerSetApiKeyCommand(context, settingsProvider, hookInstaller);
  registerReviewPromptCommands(context, settingsProvider);

  const root = settingsProvider.workspaceRoot;
  if (root) {
    const configWatcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(root, WORKSPACE_CONFIG_REL)
    );
    const promptWatcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(root, WORKSPACE_PROMPT_REL)
    );
    const refresh = () => {
      settingsProvider.invalidateCache();
      updateStatusBar(settingsProvider, hookInstaller);
      if (settingsProvider.hasConfigParseError) {
        hookInstaller.removeAllManagedHooks();
        updateStatusBar(settingsProvider, hookInstaller);
        return;
      }
      void hookInstaller.syncFromConfig(settingsProvider).then(() => {
        updateStatusBar(settingsProvider, hookInstaller);
      });
    };
    const refreshGuide = () => {
      settingsProvider.invalidateCache();
      settingsProvider.writeWorkspaceGuideOnly();
    };
    configWatcher.onDidChange(refresh);
    configWatcher.onDidCreate(refresh);
    configWatcher.onDidDelete(refresh);
    promptWatcher.onDidChange(refreshGuide);
    promptWatcher.onDidCreate(refreshGuide);
    context.subscriptions.push(configWatcher, promptWatcher);
  }

  const depOptions =
    settingsProvider.reviewMode === "provider"
      ? { silent: true as const, skipAgent: true }
      : { silent: true as const, agentType: settingsProvider.agent };
  void ensureDependencies(context, depOptions).then((status) => {
    if (!status.reviewCli) {
      notifyDependencyIssues(status);
      return;
    }
    if (settingsProvider.reviewMode === "agent" && !status.agent) {
      notifyDependencyIssues(status, { agentType: settingsProvider.agent });
    }
  });

  const legacyCleaned = hookInstaller.removeLegacyHookBlocks();
  void hookInstaller.syncFromConfig(settingsProvider).then(() => {
    updateStatusBar(settingsProvider, hookInstaller);
    if (legacyCleaned > 0) {
      void vscode.window.showInformationMessage(
        `已自动移除 ${legacyCleaned} 个旧版 Pre-push 审查 hook 片段；若需继续自动审查，请运行「启用 AI Code Review」。`
      );
    }
  });

  context.subscriptions.push(getReviewOutputChannel());
}

export function deactivate() {}
