import * as vscode from "vscode";

const CHANNEL_NAME = "AI Code Review";

let channel: vscode.OutputChannel | undefined;

export function getReviewOutputChannel(): vscode.OutputChannel {
  if (!channel) {
    channel = vscode.window.createOutputChannel(CHANNEL_NAME);
  }
  return channel;
}

export function showReviewOutput(): void {
  getReviewOutputChannel().show(true);
}

export function clearReviewOutput(): void {
  getReviewOutputChannel().clear();
}

export function appendReviewOutput(text: string): void {
  getReviewOutputChannel().append(text);
}

export function logReviewLine(line: string): void {
  getReviewOutputChannel().appendLine(line);
}
