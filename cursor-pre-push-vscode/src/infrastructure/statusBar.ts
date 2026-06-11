import * as vscode from "vscode";
import { SettingsProvider } from "../settings/settingsProvider";
import { HookInstaller } from "./hookInstaller";

let statusBarItem: vscode.StatusBarItem | undefined;

export function updateStatusBar(
  settingsProvider: SettingsProvider,
  hookInstaller: HookInstaller
): void {
  if (!statusBarItem) {
    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    statusBarItem.command = "aiCodeReview.openReport";
  }

  const hookInstalled = hookInstaller.isHookInstalled();
  const enabled = settingsProvider.enabled;
  const configuredHooks = settingsProvider.hooks;
  const installedHooks = hookInstaller.getInstalledHookTypes();
  const missingHooks = configuredHooks.filter((hook) => !installedHooks.includes(hook));
  const mode =
    settingsProvider.reviewMode === "provider"
      ? settingsProvider.providerType
      : settingsProvider.agent;

  if (!hookInstalled && !enabled) {
    statusBarItem.text = "$(warning) AI Review: 未启用";
    statusBarItem.color = "#f0ad4e";
  } else if (!enabled) {
    statusBarItem.text = "$(circle-slash) AI Review: 已关闭";
    statusBarItem.color = undefined;
  } else if (configuredHooks.length > 0 && missingHooks.length > 0) {
    statusBarItem.text = `$(warning) AI Review: hook 未同步 (${missingHooks.join(",")})`;
    statusBarItem.color = "#f0ad4e";
  } else {
    const hooks = installedHooks.join(",") || "manual";
    statusBarItem.text = `$(check) AI Review: ${mode} (${hooks})`;
    statusBarItem.color = "#4fd1c5";
  }

  statusBarItem.show();
}
