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
    statusBarItem.command = "cursor.prePush.openReport";
  }

  const hookInstalled = hookInstaller.isHookInstalled();
  const enabled = settingsProvider.enabled;

  if (!hookInstalled) {
    statusBarItem.text = "$(warning) Pre-push: 未安装 hook";
    statusBarItem.color = "#f0ad4e";
  } else if (!enabled) {
    statusBarItem.text = "$(circle-slash) Pre-push: 已关闭";
    statusBarItem.color = undefined;
  } else {
    statusBarItem.text = "$(check) Pre-push: 已启用";
    statusBarItem.color = "#4fd1c5";
  }

  statusBarItem.show();
}
