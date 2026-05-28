import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";

export class ReportWebview {
  public static async show(context: vscode.ExtensionContext): Promise<void> {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!root) return;

    const reportPath = path.join(root, ".cursor", "pre-push-find-bugs-last.md");
    if (!fs.existsSync(reportPath)) {
      vscode.window.showInformationMessage("暂无审查报告");
      return;
    }

    const content = fs.readFileSync(reportPath, "utf8");
    const panel = vscode.window.createWebviewPanel(
      "prePushReport",
      "Pre-push 审查报告",
      vscode.ViewColumn.One,
      { enableScripts: true }
    );

    panel.webview.html = ReportWebview.renderHtml(content);
  }

  private static escapeHtml(text: string): string {
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  private static renderHtml(markdown: string): string {
    const fenced: string[] = [];
    const withoutFences = markdown.replace(/```+[^\n]*\n([\s\S]*?)```+/g, (_m, body) => {
      const idx = fenced.length;
      fenced.push(`<pre><code>${ReportWebview.escapeHtml(body)}</code></pre>`);
      return `@@FENCE_${idx}@@`;
    });

    let html = ReportWebview.escapeHtml(withoutFences)
      .replace(/^# (.*)$/gm, "<h1>$1</h1>")
      .replace(/^## (.*)$/gm, "<h2>$1</h2>")
      .replace(/^### (.*)$/gm, "<h3>$1</h3>")
      .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\n/g, "<br>");

    fenced.forEach((block, idx) => {
      html = html.replace(`@@FENCE_${idx}@@`, block);
    });

    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; padding: 20px; line-height: 1.5; }
          h1 { color: #333; }
          pre { background: #f4f4f4; padding: 12px; overflow-x: auto; white-space: pre-wrap; }
          code { background: #f4f4f4; padding: 2px 5px; }
          strong { color: #c00; }
        </style>
      </head>
      <body>${html}</body>
      </html>
    `;
  }
}