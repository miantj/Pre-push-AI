"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.ReportWebview = void 0;
const vscode = __importStar(require("vscode"));
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
class ReportWebview {
    static async show(context) {
        const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (!root)
            return;
        const reportPath = path.join(root, ".cursor", "pre-push-find-bugs-last.md");
        if (!fs.existsSync(reportPath)) {
            vscode.window.showInformationMessage("暂无审查报告");
            return;
        }
        const content = fs.readFileSync(reportPath, "utf8");
        const panel = vscode.window.createWebviewPanel("prePushReport", "Pre-push 审查报告", vscode.ViewColumn.One, { enableScripts: true });
        panel.webview.html = ReportWebview.renderHtml(content);
    }
    static escapeHtml(text) {
        return text
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;");
    }
    static renderHtml(markdown) {
        const fenced = [];
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
exports.ReportWebview = ReportWebview;
