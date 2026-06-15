import * as vscode from "vscode";
import { SettingsProvider } from "../settings/settingsProvider";
import { HookInstaller } from "./hookInstaller";

let statusBarItem: vscode.StatusBarItem | undefined;
let reviewInProgress = false;

function ensureStatusBarItem(): vscode.StatusBarItem {
  if (!statusBarItem) {
    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    statusBarItem.command = "aiCodeReview.openReport";
  }
  return statusBarItem;
}

/** 手动审查进行中：状态栏显示旋转图标与最新进度 */
export function setReviewProgress(message: string): void {
  reviewInProgress = true;
  const item = ensureStatusBarItem();
  const text = message.trim();
  item.text = text ? `$(sync~spin) AI Review: ${text}` : "$(sync~spin) AI Review: 审查中…";
  item.tooltip = "AI Code Review 正在审查，点击查看上次报告";
  item.color = "#4fd1c5";
  item.show();
}

export function endReviewProgress(
  settingsProvider: SettingsProvider,
  hookInstaller: HookInstaller
): void {
  if (!reviewInProgress) return;
  reviewInProgress = false;
  updateStatusBar(settingsProvider, hookInstaller);
}

export function updateStatusBar(
  settingsProvider: SettingsProvider,
  hookInstaller: HookInstaller
): void {
  if (reviewInProgress) return;

  const statusBarItem = ensureStatusBarItem();
  statusBarItem.tooltip = "点击查看上次审查报告";

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
