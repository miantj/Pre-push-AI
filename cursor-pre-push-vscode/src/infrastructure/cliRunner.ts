import * as vscode from "vscode";
import { spawn } from "child_process";
import * as path from "path";
import * as fs from "fs";
import { SettingsProvider } from "../settings/settingsProvider";
import { augmentedPathEnv, getBundledReviewCliPath } from "./runtimePaths";

export async function runCliReview(
  settingsProvider: SettingsProvider,
  extensionPath: string,
  options: { reviewOnly?: boolean; forceEnabled?: boolean } = {}
): Promise<boolean> {
  const cliPath = getBundledReviewCliPath(extensionPath);

  if (!fs.existsSync(cliPath)) {
    vscode.window.showErrorMessage(`未找到 CLI: ${cliPath}`);
    return false;
  }

  const cwd = settingsProvider.workspaceRoot;
  if (!cwd) {
    vscode.window.showErrorMessage("未打开工作区文件夹，无法执行审查");
    return false;
  }

  const enabled = options.forceEnabled ?? settingsProvider.enabled;
  const cmd = options.reviewOnly ? "review" : "run";

  return new Promise((resolve) => {
    const proc = spawn(process.execPath, [cliPath, cmd], {
      cwd,
      env: {
        ...augmentedPathEnv(),
        ELECTRON_RUN_AS_NODE: "1",
        USE_AI_REVIEW_ON_PRE_PUSH_HOOK: enabled ? "true" : "false",
        CURSOR_PRE_PUSH_BASELINE: settingsProvider.baseline,
        AI_REVIEW_AGENT: settingsProvider.agent,
        CURSOR_PRE_PUSH_TIMEOUT_MS: String(settingsProvider.timeoutMs),
      },
    });

    let output = "";
    proc.stdout?.on("data", (data) => {
      output += data.toString();
    });
    proc.stderr?.on("data", (data) => {
      output += data.toString();
    });

    proc.on("close", (code) => {
      if (code !== 0) {
        const reportHint = settingsProvider.workspaceConfigPath
          ? `.cursor/pre-push-find-bugs-last.md`
          : "审查报告";
        vscode.window.showErrorMessage(
          `审查未通过（exit ${code}），请查看 ${reportHint}`
        );
        if (output.trim()) {
          console.error(output);
        }
        resolve(false);
        return;
      }
      if (output.trim()) {
        const firstLine = output.trim().split("\n")[0];
        vscode.window.showInformationMessage(firstLine.substring(0, 120));
      }
      resolve(true);
    });

    proc.on("error", (err) => {
      vscode.window.showErrorMessage(`CLI 执行失败: ${err.message}`);
      resolve(false);
    });
  });
}
