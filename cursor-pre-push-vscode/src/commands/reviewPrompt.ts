import * as vscode from "vscode";
import { SettingsProvider } from "../settings/settingsProvider";
import {
  loadDefaultEditableReviewPrompt,
  loadDefaultReviewInstructions,
} from "../shared/reviewPromptLoader";
import {
  ensureWorkspaceReviewPrompt,
  workspacePromptPath,
  writeWorkspaceReviewPrompt,
} from "../infrastructure/reviewPromptFile";

async function openReviewPromptFile(
  context: vscode.ExtensionContext,
  settingsProvider: SettingsProvider
): Promise<void> {
  const root = settingsProvider.workspaceRoot;
  if (!root) {
    vscode.window.showWarningMessage("请先打开工作区");
    return;
  }

  ensureWorkspaceReviewPrompt(context.extensionPath, root);
  const filePath = workspacePromptPath(root);
  const doc = await vscode.workspace.openTextDocument(filePath);
  await vscode.window.showTextDocument(doc, { preview: false });
}

async function openDefaultReviewPrompt(
  context: vscode.ExtensionContext,
  settingsProvider: SettingsProvider
): Promise<void> {
  if (!settingsProvider.workspaceRoot) {
    vscode.window.showWarningMessage("请先打开工作区");
    return;
  }

  const config = settingsProvider.getEffectiveConfig();
  const scope = config.defaultScope;
  const baseline = config.baseline === "auto" ? "origin/main" : config.baseline;
  let text: string;
  try {
    text = loadDefaultReviewInstructions(context.extensionPath, scope, baseline);
  } catch (e) {
    vscode.window.showErrorMessage(`无法加载默认 Prompt: ${e}`);
    return;
  }

  const doc = await vscode.workspace.openTextDocument({
    language: "markdown",
    content: [
      "# 默认 Review Prompt（只读预览）",
      "",
      "> 恢复默认时会写入 `.cursor/ai-code-review-prompt.md`。",
      "> 审查时仍会在末尾追加 git diff。",
      "> 若未写 `AI_CODE_REVIEW_VERDICT` 说明，运行时会自动拼接。",
      "",
      "---",
      "",
      text,
    ].join("\n"),
  });
  await vscode.window.showTextDocument(doc, { preview: true });
}

async function resetReviewPrompt(
  context: vscode.ExtensionContext,
  settingsProvider: SettingsProvider
): Promise<void> {
  const root = settingsProvider.workspaceRoot;
  if (!root) {
    vscode.window.showWarningMessage("请先打开工作区");
    return;
  }

  let prompt: string;
  try {
    prompt = loadDefaultEditableReviewPrompt(context.extensionPath);
  } catch (e) {
    vscode.window.showErrorMessage(`无法生成默认 Prompt: ${e}`);
    return;
  }

  writeWorkspaceReviewPrompt(root, prompt);
  settingsProvider.writeWorkspaceConfigFile(settingsProvider.getEffectiveConfig());
  const doc = await vscode.workspace.openTextDocument(workspacePromptPath(root));
  await vscode.window.showTextDocument(doc, { preview: false });
  vscode.window.showInformationMessage("已恢复默认 Review Prompt（已写入 prompt 文件）");
}

export function registerReviewPromptCommands(
  context: vscode.ExtensionContext,
  settingsProvider: SettingsProvider
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("aiCodeReview.openReviewPrompt", () =>
      openReviewPromptFile(context, settingsProvider)
    ),
    vscode.commands.registerCommand("aiCodeReview.previewReviewPrompt", () =>
      openDefaultReviewPrompt(context, settingsProvider)
    ),
    vscode.commands.registerCommand("aiCodeReview.resetReviewPrompt", () =>
      resetReviewPrompt(context, settingsProvider)
    )
  );
}
